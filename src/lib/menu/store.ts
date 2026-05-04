// src/lib/menu/store.ts
//
// Solid reactive store wrapping the pure menu reducer in `state.ts`.
//
// This is the *imperative bridge* between the pure D1 reducer
// (`reduce(state, input): MenuState`) and every reactive consumer
// (`RadialMenu.tsx`, the gamepad dispatcher in H1, story drivers, tests).
// The reducer remains pure; this module is the only place where mutable,
// observable state lives.
//
// External code interacts with the store in exactly two ways:
//   - read via `menuState()` (and the convenience `isMenuOpen()`)
//   - write via `dispatchMenuInput(input)` — which calls `reduce` and
//     stores the result. There is *no* direct setter.
//
// Solid is the only framework dep here. No imports from src/ui/,
// src/runtime/, src/effects/, or src/editors/ — see eslint boundaries.
//
// Hot-reload note: Vite HMR on this module replaces the underlying signal
// instance, which means consumers reading via the accessor will see the
// fresh `INITIAL_STATE` and recover after one input. We accept the standard
// reset rather than wiring `import.meta.hot` — the menu is short-lived
// (open → pick → close) and re-opening once after an HMR cycle is fine.
//
// @see docs/specs/radial-menu.md §11.1
// @see src/lib/menu/state.ts (the pure reducer)

import { createSignal } from "solid-js";
import { INITIAL_STATE, reduce } from "./state";
import type { MenuInput, MenuState } from "./types";

// ---------------------------------------------------------------------------
// Internal signal — the single source of truth for menu state.
// ---------------------------------------------------------------------------

const [_state, _setState] = createSignal<MenuState>(INITIAL_STATE);

// ---------------------------------------------------------------------------
// Read accessors
// ---------------------------------------------------------------------------

/**
 * Solid-friendly accessor returning the current menu state. Tracks reactively
 * inside `createEffect` / `createMemo` / JSX.
 */
export const menuState: () => MenuState = _state;

/**
 * Convenience accessor: `true` whenever the menu is mounted (any phase other
 * than `closed`). Useful for the gamepad layer's `when:` predicate per
 * spec §11.3.
 */
export function isMenuOpen(): boolean {
  return _state().phase !== "closed";
}

// ---------------------------------------------------------------------------
// Write surface — single mutation function wrapping the pure reducer.
// ---------------------------------------------------------------------------

/**
 * Apply a `MenuInput` to the current state by running the pure reducer and
 * storing the result. This is the ONLY way to mutate the menu store.
 *
 * Pure dispatch — no side effects beyond writing the signal. The reducer
 * itself remains pure; verb application, document mutation, and overlay
 * mounting are the dispatcher's job (track H1, `dispatcher.ts`).
 */
export function dispatchMenuInput(input: MenuInput): void {
  const next = reduce(_state(), input);
  // The reducer returns the same reference for no-op transitions; Solid's
  // signal equality check then short-circuits the update. Pass through
  // unconditionally — Solid handles the deduplication.
  _setState(next);
}
