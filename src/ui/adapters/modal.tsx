/**
 * Modal adapter - imperative modal API without island dependency.
 *
 * This module provides the same API as the islands/modal.tsx island but
 * can be imported directly without requiring a separate script tag.
 */
import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { HtmlModal } from "../Modal";

type ModalState = {
  id: string;
  title: string;
  content: string;
} | null;

const [modalState, setModalState] = createSignal<ModalState>(null);

function ensureModalRoot(): HTMLElement {
  const existing = document.getElementById("solid-modal-root");
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = "solid-modal-root";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "1000";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  return el;
}

/**
 * Show a modal with the given id, title, and HTML content.
 */
export function showModal(id: string, title: string, content: string): void {
  setModalState({ id, title, content });
}

/**
 * Close the currently open modal.
 */
export function closeModal(_id: string): void {
  setModalState(null);
}

let mounted = false;

/**
 * Check if we're in a browser environment.
 */
function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

/**
 * Mount the modal root element and render the modal component.
 * Safe to call multiple times; will only mount once.
 * In non-browser environments (e.g., Node.js tests), this is a no-op.
 */
export function mountModal(root?: HTMLElement): void {
  if (mounted) return;
  if (!isBrowser()) return;
  mounted = true;

  const el = root || ensureModalRoot();
  render(
    () => (
      <Show when={modalState()}>
        {(state) => (
          <div style={{ "pointer-events": "auto" }}>
            <HtmlModal
              id={state().id}
              title={state().title}
              content={state().content}
              onClose={() => setModalState(null)}
            />
          </div>
        )}
      </Show>
    ),
    el,
  );
}
