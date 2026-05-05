// src/lib/mainMenu/store.ts
//
// Reactive store for the main menu overlay. Minimal open/closed/focus
// state machine — enough to show the menu and navigate its items.
//
// Follows the same pattern as src/lib/menu/store.ts: a Solid signal
// holding immutable state, mutated only through a dispatch function
// that runs a pure reducer.
//
// No imports from src/ui/, src/runtime/, src/effects/, or src/editors/.
// @see docs/specs/main-menu.md

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MainMenuState {
  /** Whether the menu is open. */
  open: boolean;
  /** Index of the focused item in the current list. */
  focusIndex: number;
  /** Stack of submenu IDs (empty = root level). */
  submenuStack: string[];
}

export type MainMenuAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "next"; itemCount: number }
  | { type: "prev"; itemCount: number }
  | { type: "select" }
  | { type: "back" }
  | { type: "pushSubmenu"; submenuId: string }
  | { type: "popSubmenu" };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: MainMenuState = {
  open: false,
  focusIndex: 0,
  submenuStack: [],
};

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

export function reduce(
  state: MainMenuState,
  action: MainMenuAction,
): MainMenuState {
  switch (action.type) {
    case "open":
      if (state.open) return state;
      return { open: true, focusIndex: 0, submenuStack: [] };

    case "close":
      if (!state.open) return state;
      return INITIAL_STATE;

    case "next":
      if (!state.open) return state;
      return {
        ...state,
        focusIndex: (state.focusIndex + 1) % action.itemCount,
      };

    case "prev":
      if (!state.open) return state;
      return {
        ...state,
        focusIndex:
          (state.focusIndex - 1 + action.itemCount) % action.itemCount,
      };

    case "pushSubmenu":
      return {
        ...state,
        submenuStack: [...state.submenuStack, action.submenuId],
        focusIndex: 0,
      };

    case "popSubmenu": {
      if (state.submenuStack.length === 0) return state;
      return {
        ...state,
        submenuStack: state.submenuStack.slice(0, -1),
        focusIndex: 0,
      };
    }

    case "back":
      if (!state.open) return state;
      if (state.submenuStack.length > 0) {
        return reduce(state, { type: "popSubmenu" });
      }
      // At root level, back = close
      return INITIAL_STATE;

    case "select":
      // Selection is handled by the consumer; we just return the state
      // so the consumer can read focusIndex and decide what to do.
      return state;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Reactive signal
// ---------------------------------------------------------------------------

const [_state, _setState] = createSignal<MainMenuState>(INITIAL_STATE);

// ---------------------------------------------------------------------------
// Read accessors
// ---------------------------------------------------------------------------

/** Solid-friendly accessor for the current main menu state. */
export const mainMenuState: () => MainMenuState = _state;

/** Convenience: true when the main menu is open. */
export function isMainMenuOpen(): boolean {
  return _state().open;
}

// ---------------------------------------------------------------------------
// Write surface
// ---------------------------------------------------------------------------

/** Dispatch an action to the main menu store. */
export function dispatchMainMenu(action: MainMenuAction): void {
  _setState(reduce(_state(), action));
}

/** Open the main menu. */
export function openMainMenu(): void {
  dispatchMainMenu({ type: "open" });
}

/** Close the main menu. */
export function closeMainMenu(): void {
  dispatchMainMenu({ type: "close" });
}
