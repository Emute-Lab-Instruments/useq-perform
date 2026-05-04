// src/zen/zenActionBus.ts
//
// Local observer for gamepad-resolved ActionIds while zen mode is mounted.
// The zen mode's gamepad pipeline is configured with `onAction: publish`
// (see ZenMode.tsx); inner views (grid in ZenMode, exercise in
// ZenExercise) register handlers here for the duration they are active.
//
// This replaces the legacy `gamepadChannels.ts` per-direction channels
// that used to ferry directional intents to non-editor surfaces. Routing
// by ActionId keeps the keyboard and gamepad symmetric: an exercise
// reacts the same way whether the user presses Enter or Start.

import type { ActionId } from "../lib/keybindings/actions";

export type ZenActionHandler = (action: ActionId) => boolean;

const handlers: Set<ZenActionHandler> = new Set();

/** Register a handler. Returns an unsubscribe function. */
export function subscribeZenAction(handler: ZenActionHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
 * Publish an action. Each registered handler is invoked in registration
 * order; the first to return true short-circuits the chain and is treated
 * as having consumed the action.
 */
export function publishZenAction(action: ActionId): boolean {
  for (const h of handlers) {
    if (h(action)) return true;
  }
  return false;
}

/** Test-only: clear all registered handlers. */
export function _resetZenActionBusForTests(): void {
  handlers.clear();
}
