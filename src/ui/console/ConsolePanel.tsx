/**
 * REPL Console Panel — displays evaluation results and log messages.
 *
 * Positioned in the bottom-right of the editor viewport. Resizable,
 * draggable, and collapsible into a small tab. Uses the theme's CSS
 * variables for all colors so it tracks theme changes automatically.
 */

import {
  For,
  Show,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from "solid-js";
import {
  consoleStore,
  clearConsole,
  type ConsoleMessage,
} from "../../utils/consoleStore.ts";
import { settings as globalSettings } from "../../utils/settingsStore.ts";
import { usePointerDrag } from "../panel-chrome/usePointerDrag.ts";
import type { ConsoleSettings } from "../../lib/settings/schema.ts";
import { advanceQueue, completeActive } from "./typewriterQueue.ts";
import "./console.css";

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

const MIN_W = 280;
const MIN_H = 120;

interface Size {
  w: number;
  h: number;
}

function defaultSize(): Size {
  return {
    w: Math.min(520, window.innerWidth * 0.4),
    h: Math.min(340, window.innerHeight * 0.35),
  };
}

// ---------------------------------------------------------------------------
// Typewriter effect
// ---------------------------------------------------------------------------

function TypewriterText(props: {
  text: string;
  charIntervalMs: number;
  onComplete?: () => void;
}) {
  const [visibleChars, setVisibleChars] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    const intervalMs = Math.max(1, props.charIntervalMs);
    timer = setInterval(() => {
      setVisibleChars((n) => {
        const next = n + 1;
        if (next >= props.text.length) {
          clearInterval(timer);
          props.onComplete?.();
          return props.text.length;
        }
        return next;
      });
    }, intervalMs);
  });

  onCleanup(() => clearInterval(timer));

  return (
    <>
      {props.text.slice(0, visibleChars())}
      <Show when={visibleChars() < props.text.length}>
        <span class="console-typewriter-cursor" />
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// Console Entry
// ---------------------------------------------------------------------------

function ConsoleEntry(props: {
  message: ConsoleMessage;
  settings: ConsoleSettings;
  /** ID of the message currently being typewritten (panel-level). */
  typewriterActiveId: () => number | null;
  /**
   * Highest message id that was flushed by the burst valve. Entries with
   * `id <= flushedUpToId` render instantly (no typewriter); newer entries
   * animate normally.
   */
  flushedUpToId: () => number;
  /** Called when this entry's typewriter finishes. */
  onTypewriterDone: (id: number) => void;
}) {
  const s = () => props.settings;
  const msg = () => props.message;
  const isTypewriter = () => s().entryAnimation === "typewriter";

  /** This entry was flushed by the burst valve — show full text instantly. */
  const isFlushed = () => msg().id <= props.flushedUpToId();

  /** This entry is the one currently typing. */
  const isActiveTypewriter = () =>
    isTypewriter() && !isFlushed() && props.typewriterActiveId() === msg().id;

  /** This entry is waiting for an earlier typewriter to finish. */
  const isPendingTypewriter = () => {
    if (!isTypewriter() || isFlushed()) return false;
    const activeId = props.typewriterActiveId();
    return activeId !== null && activeId < msg().id;
  };

  /** Typewriter is done (or was never needed) — show full text. */
  const [done, setDone] = createSignal(!isTypewriter());

  const animClass = () => {
    if (isTypewriter()) return "";
    switch (s().entryAnimation) {
      case "slide": return "console-entry--animate-slide";
      case "fade": return "console-entry--animate-fade";
      default: return "";
    }
  };

  const compactClass = () => s().showTypeBadge ? "" : "console-entry--compact";

  const handleComplete = () => {
    setDone(true);
    props.onTypewriterDone(msg().id);
  };

  return (
    <div
      class={`console-entry console-entry--${msg().type} ${animClass()} ${compactClass()}`}
    >
      <Show when={s().showTimestamp}>
        <span class="console-timestamp">
          {new Date(msg().timestamp).toTimeString().slice(0, 8)}
        </span>
      </Show>
      <Show when={s().showTypeBadge} fallback={
        <span class="console-prompt-char">&gt;</span>
      }>
        <span class="console-type-badge">{msg().type}</span>
      </Show>
      <span class="console-entry-content">
        <Show when={msg().type === "wasm"}>
          <span class="console-eval-prefix">{";=>"} </span>
        </Show>
        <Show when={isActiveTypewriter()} fallback={
          <Show when={!isPendingTypewriter() || done()} fallback={
            <span class="console-typewriter-cursor" />
          }>
            <span innerHTML={msg().content} />
          </Show>
        }>
          <TypewriterText
            text={stripHtml(msg().content)}
            charIntervalMs={s().typewriterIntervalMs}
            onComplete={handleComplete}
          />
        </Show>
      </span>
    </div>
  );
}

function stripHtml(html: string): string {
  const tmp = document.createElement("span");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

// ---------------------------------------------------------------------------
// Resize edge component (bottom-right anchored: n/w/nw grow away from anchor)
// ---------------------------------------------------------------------------

type ResizeEdge = "n" | "w" | "nw";

function ResizeZone(props: {
  edge: ResizeEdge;
  size: () => Size;
  setSize: (s: Size) => void;
}) {
  const drag = usePointerDrag({
    onStart: () => { /* snapshot taken via closure */ },
    onMove: (_e, dx, dy) => {
      const p = startSize;
      let { w, h } = p;

      if (props.edge.includes("w")) w = p.w - dx;
      if (props.edge.includes("n")) h = p.h - dy;

      props.setSize({ w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) });
    },
  });

  let startSize: Size;

  const handlePointerDown = (e: PointerEvent) => {
    startSize = { ...props.size() };
    drag(e);
  };

  return (
    <div
      class={`console-resize-zone console-resize-zone--${props.edge}`}
      onPointerDown={handlePointerDown}
    />
  );
}

// ---------------------------------------------------------------------------
// Main Console Panel
// ---------------------------------------------------------------------------

export function ConsolePanel() {
  const [size, setSize] = createSignal<Size>(defaultSize());
  const [collapsed, setCollapsed] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [isAutoScrolling, setIsAutoScrolling] = createSignal(true);
  const [showScrollIndicator, setShowScrollIndicator] = createSignal(false);
  const [typewriterActiveId, setTypewriterActiveId] = createSignal<number | null>(null);
  // Burst pressure valve: when the typewriter queue backs up, flush all
  // pending entries instantly and resume one-at-a-time animation afterwards.
  // Tracks the highest message id flushed so far; newer entries still animate.
  const [flushedUpToId, setFlushedUpToId] = createSignal(0);
  let contentRef: HTMLDivElement | undefined;
  let prevMessageCount = 0;

  const consoleSettings = (): ConsoleSettings =>
    globalSettings.console ?? {
      showTimestamp: true,
      showTypeBadge: true,
      entryAnimation: "slide",
      typewriterIntervalMs: 20,
    };

  const onTypewriterDone = (id: number) => {
    const next = completeActive(consoleStore.messages, id, {
      activeId: typewriterActiveId(),
      flushedUpToId: flushedUpToId(),
    });
    setTypewriterActiveId(next.activeId);
  };

  createEffect(() => {
    const msgs = consoleStore.messages;
    const count = msgs.length;
    if (count > prevMessageCount) {
      if (collapsed()) {
        setUnreadCount((n) => n + (count - prevMessageCount));
      } else if (isAutoScrolling()) {
        requestAnimationFrame(() => {
          if (contentRef) contentRef.scrollTop = contentRef.scrollHeight;
        });
      }
      if (consoleSettings().entryAnimation === "typewriter") {
        // Advance the typewriter queue, applying the burst pressure valve.
        const next = advanceQueue(msgs, {
          activeId: typewriterActiveId(),
          flushedUpToId: flushedUpToId(),
        });
        setTypewriterActiveId(next.activeId);
        setFlushedUpToId(next.flushedUpToId);
      }
    }
    prevMessageCount = count;
  });

  const onScroll = () => {
    if (!contentRef) return;
    const atBottom =
      contentRef.scrollHeight - contentRef.scrollTop - contentRef.clientHeight < 30;
    setIsAutoScrolling(atBottom);
    setShowScrollIndicator(!atBottom);
  };

  const scrollToBottom = () => {
    if (contentRef) contentRef.scrollTop = contentRef.scrollHeight;
    setIsAutoScrolling(true);
    setShowScrollIndicator(false);
  };

  const collapse = () => {
    setCollapsed(true);
    setUnreadCount(0);
  };

  const expand = () => {
    setCollapsed(false);
    setUnreadCount(0);
    requestAnimationFrame(scrollToBottom);
  };

  const edges: ResizeEdge[] = ["n", "w", "nw"];

  return (
    <>
      {/* Expanded panel */}
      <div
        class="console-panel"
        classList={{ "console-panel--hidden": collapsed() }}
        style={{
          width: `${size().w}px`,
          height: `${size().h}px`,
        }}
      >
        {/* Resize zones */}
        <For each={edges}>
          {(edge) => <ResizeZone edge={edge} size={size} setSize={setSize} />}
        </For>

        {/* Title bar */}
        <div class="console-title-bar">
          <span class="title-text">
            <span class="title-accent">&gt;</span> console
          </span>
          <span class="spacer" />
          <span class="console-badge">{consoleStore.messages.length}</span>
          <button
            class="console-chrome-btn console-chrome-btn--danger"
            onClick={clearConsole}
            title="Clear"
          >
            &times;
          </button>
          <button
            class="console-chrome-btn"
            onClick={collapse}
            title="Collapse"
          >
            &#9662;
          </button>
        </div>

        {/* Content */}
        <div
          class="console-content"
          ref={contentRef}
          onScroll={onScroll}
        >
          <Show
            when={consoleStore.messages.length > 0}
            fallback={
              <div class="console-empty">
                <span class="console-empty-prompt">_</span>
                <span>awaiting evaluation</span>
              </div>
            }
          >
            <For each={consoleStore.messages}>
              {(msg) => (
                <ConsoleEntry
                  message={msg}
                  settings={consoleSettings()}
                  typewriterActiveId={typewriterActiveId}
                  flushedUpToId={flushedUpToId}
                  onTypewriterDone={onTypewriterDone}
                />
              )}
            </For>
          </Show>
        </div>

        {/* Footer */}
        <div class="console-footer">
          <span>modulisp</span>
          <span style={{ color: "var(--accent-color)", opacity: "0.5" }}>wasm</span>
          <span class="spacer" />
          <button
            class="console-scroll-indicator"
            classList={{ "console-scroll-indicator--visible": showScrollIndicator() }}
            onClick={scrollToBottom}
            title="Scroll to bottom"
          >
            &#8595; new messages
          </button>
        </div>
      </div>

      {/* Collapsed tab */}
      <div
        class="console-collapsed-tab"
        classList={{ "console-collapsed-tab--hidden": !collapsed() }}
        onClick={expand}
      >
        <span class="tab-accent">&gt;</span> console
        <Show when={unreadCount() > 0}>
          <span class="console-unread-badge">{unreadCount()}</span>
        </Show>
      </div>
    </>
  );
}
