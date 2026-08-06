// Text-entry layouts and stateful input coordination for radial-menu numpad
// and T9 modes. The menu dispatcher delegates sub-mode actions here so its
// lifecycle routing does not also own multi-tap timing and hover state.

import type { ActionId } from "../keybindings/actions";
import type { HoleType, MenuInput, MenuState, MenuStateT9 } from "./types";

const NUMPAD_CHARS: readonly string[] = [
  "1", "2", "3", "4", "6", "7", "8", "9",
  "5",
  "0", ",", ".", "±", "e", "⌫", "Esc", "✓",
];

export const NUMPAD_INNER_COUNT = 9;
export const NUMPAD_TOTAL_COUNT = NUMPAD_CHARS.length;

export function numpadCharAt(index: number): string | null {
  if (index < 0 || index >= NUMPAD_CHARS.length) return null;
  return NUMPAD_CHARS[index] ?? null;
}

const T9_GROUPS: readonly (readonly string[])[] = [
  ["-", "_", "/", "1"],
  ["a", "b", "c", "2"],
  ["d", "e", "f", "3"],
  ["g", "h", "i", "4"],
  ["j", "k", "l", "5"],
  ["m", "n", "o", "6"],
  ["p", "q", "r", "s"],
  ["t", "u", "v", "8"],
  ["w", "x", "y", "z"],
];

export const T9_DIGIT_LABELS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const T9_POSITION_COUNT = T9_GROUPS.length;
export const T9_COMMIT_TIMEOUT_MS = 600;

export function t9GroupAt(keyIndex: number): readonly string[] | null {
  if (keyIndex < 0 || keyIndex >= T9_GROUPS.length) return null;
  return T9_GROUPS[keyIndex] ?? null;
}

export function t9CharAt(keyIndex: number, tapCount: number, upper = false): string | null {
  const group = t9GroupAt(keyIndex);
  if (group === null) return null;
  const char = group[tapCount % group.length];
  if (char === undefined) return null;
  return upper ? char.toUpperCase() : char;
}

export function textModeForHoleType(holeType: HoleType | null): "numpad" | "t9" | null {
  switch (holeType) {
    case "number":
      return "numpad";
    case "string":
    case "symbol":
      return "t9";
    case "keyword":
    case "expr":
    case null:
      return null;
  }
}

export interface TextEntryController {
  reset(): void;
  appendNumpad(char: string): void;
  handleAxis(state: MenuState, stick: "left" | "right", hover: number | null): boolean;
  handleVerbAction(state: MenuState, action: ActionId): boolean;
}

interface TextEntryControllerDeps {
  readonly getMenuState: () => MenuState;
  readonly dispatchInput: (input: MenuInput) => void;
}

/** Owns ephemeral stick-selection and T9 multi-tap timing for text sub-modes. */
export function createTextEntryController(deps: TextEntryControllerDeps): TextEntryController {
  let numpadHoverChar: string | null = null;
  let t9HoverIdx: number | null = null;
  let t9TapCount = 0;
  let t9ActiveIdx: number | null = null;
  let t9IdleTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    reset,

    appendNumpad(char): void {
      if (deps.getMenuState().phase === "numpad") {
        deps.dispatchInput({ kind: "subModeAppend", char });
      }
    },

    handleAxis(state, stick, hover): boolean {
      if (state.phase === "numpad") {
        if (stick === "left") {
          numpadHoverChar = hover !== null ? numpadCharAt(hover) : null;
        }
        return true;
      }
      if (state.phase === "t9") {
        if (stick === "left") {
          t9HoverIdx = hover !== null && hover >= 0 && hover < T9_POSITION_COUNT ? hover : null;
        }
        return true;
      }
      return false;
    },

    handleVerbAction(state, action): boolean {
      if (state.phase === "numpad") {
        handleNumpadAction(action);
        return true;
      }
      if (state.phase === "t9") {
        handleT9Action(state, action);
        return true;
      }
      return false;
    },
  };

  function handleNumpadAction(action: ActionId): void {
    switch (action) {
      case "menu.verb.insert":
        if (numpadHoverChar !== null) {
          deps.dispatchInput({ kind: "subModeAppend", char: numpadHoverChar });
        }
        return;
      case "menu.verb.replace":
        deps.dispatchInput({ kind: "subModeCommitAndContinue" });
        return;
      case "menu.verb.wrapWith":
        deps.dispatchInput({ kind: "subModeBackspace" });
        return;
      case "menu.verb.call":
        deps.dispatchInput({ kind: "subModeCommitAndExit" });
        return;
    }
  }

  function handleT9Action(state: MenuStateT9, action: ActionId): void {
    switch (action) {
      case "menu.verb.insert":
        cycleT9(state);
        return;
      case "menu.verb.replace":
        commitPendingT9();
        deps.dispatchInput({ kind: "subModeCommitAndContinue" });
        return;
      case "menu.verb.wrapWith":
        commitPendingT9();
        deps.dispatchInput({ kind: "subModeBackspace" });
        return;
      case "menu.verb.call":
        commitPendingT9();
        deps.dispatchInput({ kind: "subModeCommitAndExit" });
        return;
    }
  }

  function cycleT9(state: MenuStateT9): void {
    const pos = t9HoverIdx;
    if (pos === null || t9GroupAt(pos) === null) return;

    if (t9ActiveIdx === pos) {
      t9TapCount++;
    } else {
      commitPendingT9();
      t9ActiveIdx = pos;
      t9TapCount = 0;
    }

    const char = t9CharAt(pos, t9TapCount, state.caseMode === "upper");
    if (char === null) return;
    if (t9TapCount > 0) {
      deps.dispatchInput({ kind: "subModeBackspace" });
    }
    deps.dispatchInput({ kind: "subModeAppend", char });

    const ts = performance.now();
    deps.dispatchInput({ kind: "subModeT9Cycle", key: T9_DIGIT_LABELS[pos] ?? String(pos), ts });
    resetT9Timer();
  }

  function commitPendingT9(): void {
    if (t9ActiveIdx === null) return;
    deps.dispatchInput({ kind: "subModeT9IdleCommit", ts: performance.now() });
    t9ActiveIdx = null;
    t9TapCount = 0;
    clearT9Timer();
  }

  function resetT9Timer(): void {
    clearT9Timer();
    t9IdleTimer = setTimeout(() => {
      if (deps.getMenuState().phase === "t9") {
        commitPendingT9();
      } else {
        t9ActiveIdx = null;
        t9TapCount = 0;
      }
    }, T9_COMMIT_TIMEOUT_MS);
  }

  function clearT9Timer(): void {
    if (t9IdleTimer !== null) {
      clearTimeout(t9IdleTimer);
      t9IdleTimer = null;
    }
  }

  function reset(): void {
    clearT9Timer();
    numpadHoverChar = null;
    t9HoverIdx = null;
    t9TapCount = 0;
    t9ActiveIdx = null;
  }
}
