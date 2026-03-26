/**
 * keyNotation.ts — Convert KeyboardEvent to CodeMirror key notation.
 *
 * Shared between KeybindingsPanel (list-based rebinding) and
 * KeyboardVisualiser (click-to-rebind edit mode).
 */

// ---------------------------------------------------------------------------
// Special key mapping
// ---------------------------------------------------------------------------

/** Map KeyboardEvent.key values to CodeMirror-style key names. */
const SPECIAL_KEYS: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  " ": "Space",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/** Pure modifier keys -- not valid as a binding on their own. */
const MODIFIER_ONLY = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "OS",
]);

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a raw KeyboardEvent into CodeMirror key notation.
 * Returns null if the event is a bare modifier press.
 */
export function keyEventToNotation(e: KeyboardEvent): string | null {
  if (MODIFIER_ONLY.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey && !e.metaKey) parts.push(isMac ? "Ctrl" : "Mod");
  if (e.metaKey) parts.push(isMac ? "Mod" : "Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  const baseKey = SPECIAL_KEYS[e.key] ?? e.key;
  parts.push(baseKey);

  return parts.join("-");
}

/**
 * Returns true if the given KeyboardEvent.key is a pure modifier.
 */
export function isModifierOnly(key: string): boolean {
  return MODIFIER_ONLY.has(key);
}
