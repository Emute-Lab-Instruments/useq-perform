import { createSignal, type Accessor } from "solid-js";
import { setPendingChord } from "../../lib/keybindings/chords.ts";
import { settings } from "../../utils/settingsStore.ts";
import { isChordLeader } from "./hintData.ts";

export type HintState = "HIDDEN" | "MODIFIER_ACTIVE" | "CHORD_PENDING";

const [hintState, setHintState] = createSignal<HintState>("HIDDEN");
const [heldModifier, setHeldModifier] = createSignal<string | null>(null);
const [pendingChordPrefix, setPendingChordPrefix] = createSignal<string | null>(null);
const [expandedNamespaces, setExpandedNamespaces] = createSignal<Set<string>>(new Set());
const [mouseInPopup, setMouseInPopup] = createSignal(false);
const [sticky, setSticky] = createSignal(false);

let holdTimer: number | null = null;
let chordTimer: number | null = null;

function getDelay(): number {
  return settings.keybindings?.modifierHintDelay ?? 500;
}

function getChordTimeout(): number {
  return settings.keybindings?.chordTimeout ?? 1500;
}

function clearTimers(): void {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (chordTimer !== null) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }
}

function transitionToHidden(): void {
  clearTimers();
  setHintState("HIDDEN");
  setHeldModifier(null);
  setPendingChordPrefix(null);
  setPendingChord(null);
  setExpandedNamespaces(new Set<string>());
  setSticky(false);
}

function startModifierHold(modifier: string): void {
  if (hintState() !== "HIDDEN") return;

  const delay = getDelay();
  if (delay <= 0) return;

  setHeldModifier(modifier);
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    if (heldModifier() === modifier && hintState() === "HIDDEN") {
      setHintState("MODIFIER_ACTIVE");
    }
  }, delay);
}

function handleNonModifierKey(key: string): void {
  const state = hintState();
  const mod = heldModifier();

  if (state === "HIDDEN" && mod) {
    if (isChordLeader(mod, key)) {
      clearTimers();
      const prefix = mod + "-" + key;
      setPendingChordPrefix(prefix);
      setPendingChord(prefix);
      setHintState("CHORD_PENDING");
      startChordTimeout();
    } else {
      transitionToHidden();
    }
    return;
  }

  if (state === "MODIFIER_ACTIVE") {
    if (mod && isChordLeader(mod, key)) {
      clearTimers();
      const prefix = mod + "-" + key;
      setPendingChordPrefix(prefix);
      setPendingChord(prefix);
      setHintState("CHORD_PENDING");
      startChordTimeout();
    } else {
      transitionToHidden();
    }
    return;
  }

  if (state === "CHORD_PENDING") {
    transitionToHidden();
  }
}

/**
 * In sticky mode, a bare key press should be treated as if the original
 * modifier were still held. Returns the modifier prefix to synthesize,
 * or null if not in sticky mode.
 */
function getStickyModifier(): string | null {
  if (sticky() && hintState() !== "HIDDEN") {
    return heldModifier();
  }
  return null;
}

function startChordTimeout(): void {
  const timeout = getChordTimeout();
  chordTimer = window.setTimeout(() => {
    chordTimer = null;
    if (hintState() === "CHORD_PENDING") {
      transitionToHidden();
    }
  }, timeout);
}

function handleModifierRelease(modifier: string): void {
  if (heldModifier() !== modifier) return;

  const state = hintState();
  if (state === "HIDDEN") {
    // Timer hadn't fired yet, just clean up
    clearTimers();
    setHeldModifier(null);
    return;
  }

  // Popup is visible — if mouse is inside, go sticky instead of dismissing
  if (mouseInPopup()) {
    setSticky(true);
    return;
  }

  transitionToHidden();
}

function handleMouseEnter(): void {
  setMouseInPopup(true);
}

function handleMouseLeave(): void {
  setMouseInPopup(false);
  // If modifier was already released (we're sticky), dismiss now
  if (sticky()) {
    transitionToHidden();
  }
}

function dismissHints(): void {
  transitionToHidden();
}

function toggleNamespace(chordKey: string): void {
  const current = expandedNamespaces();
  const next = new Set(current);
  if (next.has(chordKey)) {
    next.delete(chordKey);
  } else {
    next.add(chordKey);
  }
  setExpandedNamespaces(next);
}

export {
  hintState,
  heldModifier,
  pendingChordPrefix,
  expandedNamespaces,
  sticky,
  mouseInPopup,
  startModifierHold,
  handleNonModifierKey,
  handleModifierRelease,
  handleMouseEnter,
  handleMouseLeave,
  getStickyModifier,
  dismissHints,
  toggleNamespace,
  transitionToHidden,
};

export type { Accessor };
