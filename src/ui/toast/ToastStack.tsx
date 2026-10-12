/**
 * ToastStack — pure view for non-blocking notifications.
 *
 * Renders bottom-left (clear of the bottom-right console panel). Never takes
 * focus and is not on the overlay stack. Spec: docs/specs/overlays.md §1.7.
 */
import { For, Show } from "solid-js";
import type { ToastItem } from "./toastStore";
import "./toast.css";

export interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  onAction: (id: number) => void;
}

export function ToastStack(props: ToastStackProps) {
  return (
    <div class="toast-stack">
      <For each={props.toasts}>
        {(toast) => (
          <div
            class={`toast toast--${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
            aria-live={toast.kind === "error" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <span class="toast-message">{toast.message}</span>
            <Show when={toast.action}>
              {(action) => (
                <button
                  type="button"
                  class="toast-action"
                  onClick={() => props.onAction(toast.id)}
                >
                  {action().label}
                </button>
              )}
            </Show>
            <button
              type="button"
              class="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => props.onDismiss(toast.id)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
