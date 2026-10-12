// src/contracts/toastChannels.ts
//
// Typed channel for non-blocking toast notifications.
//
// Lives in contracts/ so that any layer (ui, effects, editors, runtime) can
// raise a toast without importing the UI. The wired toast stack in
// `src/ui/adapters/toast.tsx` is the sole subscriber.
//
// Spec: docs/specs/overlays.md §1.7 — toasts are not on the overlay stack and
// never take focus.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastRequest {
  message: string;
  kind?: ToastKind;
  /**
   * Auto-dismiss delay in milliseconds. Omit for the per-kind default;
   * `0` makes the toast sticky (dismissed only by the user or an action).
   */
  durationMs?: number;
  /** Optional single action button, e.g. `[Undo]`. Running it dismisses the toast. */
  action?: ToastAction;
}

export interface ToastEvent extends ToastRequest {
  id: number;
}

/** Fires once per `notify()` call. */
export const toastChannel: TypedChannel<ToastEvent> = createChannel<ToastEvent>();

let nextToastId = 1;

/**
 * Raise a toast notification. Returns the toast id.
 *
 * Toasts published before the toast stack module is loaded are dropped;
 * the application root loads it at startup.
 */
export function notify(request: ToastRequest): number {
  const id = nextToastId++;
  toastChannel.publish({ ...request, id });
  return id;
}
