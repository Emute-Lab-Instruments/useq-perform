// src/ui/LiveAnnouncer.tsx
//
// Screen-reader announcements via aria-live regions.
//
// `announce(message, politeness?)` is the module API any code can call; the
// `LiveAnnouncer` component renders the two visually-hidden regions (polite +
// assertive) and wires the app-wide subscriptions:
//   - eval success/failure (`codeEvaluated` channel + console error messages)
//   - runtime connection changes (`connectionChanged` channel)
//
// Rate limiting: at most one announcement per politeness level per second.
// Messages that arrive while one is pending collapse into it (latest wins),
// so bursts of rapid evals produce a single short announcement.

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

import {
  codeEvaluated,
  connectionChanged,
  type ConnectionChangedDetail,
} from "../contracts/runtimeChannels";
import { consoleStore } from "../utils/consoleStore";

import "./live-announcer.css";

export type AnnouncementPoliteness = "polite" | "assertive";

/** Minimum gap between two announcements on the same politeness level. */
const RATE_LIMIT_MS = 1000;

/**
 * How long announced text stays in its region before clearing, so an
 * identical follow-up message re-triggers the live region (regions only
 * announce on text *change*).
 */
const CLEAR_DELAY_MS = 200;

// ── Region state ────────────────────────────────────────────────

const [politeText, setPoliteText] = createSignal("");
const [assertiveText, setAssertiveText] = createSignal("");

interface RegionState {
  lastAnnouncedAt: number;
  pendingText: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  clearTimer: ReturnType<typeof setTimeout> | null;
}

function freshRegion(): RegionState {
  return { lastAnnouncedAt: 0, pendingText: "", flushTimer: null, clearTimer: null };
}

const regions: Record<AnnouncementPoliteness, RegionState> = {
  polite: freshRegion(),
  assertive: freshRegion(),
};

const setters: Record<AnnouncementPoliteness, (text: string) => void> = {
  polite: setPoliteText,
  assertive: setAssertiveText,
};

function flush(politeness: AnnouncementPoliteness): void {
  const region = regions[politeness];
  const text = region.pendingText;
  region.pendingText = "";
  region.flushTimer = null;
  if (!text) return;
  region.lastAnnouncedAt = Date.now();
  setters[politeness](text);
  if (region.clearTimer !== null) clearTimeout(region.clearTimer);
  region.clearTimer = setTimeout(() => {
    region.clearTimer = null;
    setters[politeness]("");
  }, CLEAR_DELAY_MS);
}

/**
 * Announce `message` to screen readers. Politeness defaults to `"polite"`;
 * use `"assertive"` for errors. Rate-limited to one announcement per second
 * per politeness level — later messages during the window replace the
 * pending one (burst collapse).
 */
export function announce(
  message: string,
  politeness: AnnouncementPoliteness = "polite",
): void {
  if (!message) return;
  const region = regions[politeness];
  region.pendingText = message;
  if (region.flushTimer !== null) return; // already scheduled; latest message wins
  const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - region.lastAnnouncedAt));
  if (wait === 0) {
    flush(politeness);
  } else {
    region.flushTimer = setTimeout(() => flush(politeness), wait);
  }
}

/** Clear timers/state between tests. Not for production use. */
export function resetLiveAnnouncerForTests(): void {
  for (const politeness of ["polite", "assertive"] as const) {
    const region = regions[politeness];
    if (region.flushTimer !== null) clearTimeout(region.flushTimer);
    if (region.clearTimer !== null) clearTimeout(region.clearTimer);
    regions[politeness] = freshRegion();
    setters[politeness]("");
  }
}

// ── Announcement texts ──────────────────────────────────────────

/** Short success announcement for a completed code evaluation. */
const EVAL_SUCCESS_MESSAGE = "Evaluated";
/** Longest error text read aloud; the full message stays in the console. */
const ERROR_ANNOUNCEMENT_MAX_CHARS = 120;

/** Plain-text, length-capped announcement for a console error entry. */
export function errorAnnouncement(content: string): string {
  const text = content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const capped = text.length > ERROR_ANNOUNCEMENT_MAX_CHARS
    ? `${text.slice(0, ERROR_ANNOUNCEMENT_MAX_CHARS - 1)}…`
    : text;
  return capped ? `Error: ${capped}` : "Error";
}

function connectionMessage(detail: ConnectionChangedDetail): string {
  if (detail.connectionMode === "hardware") return "Connected to uSEQ hardware";
  if (detail.connectionMode === "browser") return "Using virtual uSEQ";
  return "No runtime";
}

// ── Wired component ─────────────────────────────────────────────

export function LiveAnnouncer() {
  // Skip console messages that existed before mount. Read once, untracked:
  // only *new* messages (id > this) should be announced.
  let lastSeenMessageId =
    consoleStore.messages.length > 0
      ? consoleStore.messages[consoleStore.messages.length - 1].id
      : 0;

  createEffect(() => {
    const messages = consoleStore.messages;
    const latest = messages[messages.length - 1];
    if (!latest || latest.id <= lastSeenMessageId) return;
    lastSeenMessageId = latest.id;
    if (latest.type === "error") {
      announce(errorAnnouncement(latest.content), "assertive");
    }
  });

  onMount(() => {
    const unsubscribeConnection = connectionChanged.subscribe((detail) => {
      announce(connectionMessage(detail));
    });
    const unsubscribeEval = codeEvaluated.subscribe(() => {
      announce(EVAL_SUCCESS_MESSAGE);
    });
    onCleanup(() => {
      unsubscribeConnection();
      unsubscribeEval();
    });
  });

  return (
    <div class="live-announcer">
      <div class="live-announcer__region" aria-live="polite" aria-atomic="true">
        {politeText()}
      </div>
      <div class="live-announcer__region" aria-live="assertive" aria-atomic="true">
        {assertiveText()}
      </div>
    </div>
  );
}
