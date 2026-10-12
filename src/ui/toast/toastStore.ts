/**
 * Toast store: the visible toast list plus auto-dismiss timers.
 *
 * Framework-light: a Solid signal holds the list so the view re-renders; the
 * store itself does not render. Spec: docs/specs/overlays.md §1.7.
 */
import { createSignal, type Accessor } from "solid-js";
import type { ToastEvent, ToastKind } from "../../contracts/toastChannels";

export interface ToastItem extends ToastEvent {
  kind: ToastKind;
}

/** Default auto-dismiss delay per kind (ms). */
export const DEFAULT_TOAST_DURATION_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 4000,
  warn: 6000,
  error: 10000,
};

export const MAX_VISIBLE_TOASTS = 4;

export interface ToastStore {
  toasts: Accessor<ToastItem[]>;
  add(event: ToastEvent): void;
  dismiss(id: number): void;
  /** Run the toast's action (if any), then dismiss it. */
  runAction(id: number): void;
  clear(): void;
}

export function createToastStore(): ToastStore {
  const [toasts, setToasts] = createSignal<ToastItem[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const clearTimer = (id: number) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };

  const dismiss = (id: number) => {
    clearTimer(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  };

  const add = (event: ToastEvent) => {
    const item: ToastItem = { ...event, kind: event.kind ?? "info" };
    const next = [...toasts(), item];
    // Keep at most MAX_VISIBLE_TOASTS; the oldest are evicted first.
    const evicted = next.slice(0, Math.max(0, next.length - MAX_VISIBLE_TOASTS));
    evicted.forEach((t) => clearTimer(t.id));
    setToasts(next.slice(-MAX_VISIBLE_TOASTS));

    const duration = item.durationMs ?? DEFAULT_TOAST_DURATION_MS[item.kind];
    if (duration > 0) {
      timers.set(item.id, setTimeout(() => dismiss(item.id), duration));
    }
  };

  const runAction = (id: number) => {
    const toast = toasts().find((t) => t.id === id);
    dismiss(id);
    toast?.action?.run();
  };

  const clear = () => {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    setToasts([]);
  };

  return { toasts, add, dismiss, runAction, clear };
}
