/**
 * Modal adapter - imperative modal API.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { Show, createSignal } from "solid-js";
import { HtmlModal } from "../Modal";
import { pushOverlay } from "../overlayManager";
import { createSolidAdapter } from "./createSolidAdapter";

type ModalState = {
  id: string;
  title: string;
  content: string;
} | null;

const [modalState, setModalState] = createSignal<ModalState>(null);

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

const adapter = createSolidAdapter({
  containerId: "solid-modal-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
    pointerEvents: "none",
  },
  Component: () => (
    <Show when={modalState()}>
      {(state) => (
        <div style={{ "pointer-events": "auto" }}>
          <HtmlModal
            id={state().id}
            title={state().title}
            content={state().content}
            onClose={() => setModalState(null)}
            onOverlayRegister={pushOverlay}
          />
        </div>
      )}
    </Show>
  ),
});

/**
 * Mount the modal root element and render the modal component.
 * Safe to call multiple times; will only mount once.
 * In non-browser environments (e.g., Node.js tests), this is a no-op.
 */
export function mountModal(root?: HTMLElement): void {
  adapter.mount(root);
}
