/**
 * Modal adapter - imperative modal API.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { Show, createSignal, Switch, Match } from "solid-js";
import { HtmlModal, Modal } from "../Modal";
import { pushOverlay } from "../overlayManager";
import { createSolidAdapter } from "./createSolidAdapter";

type ModalState =
  | {
      kind: "html";
      id: string;
      title: string;
      content: string;
    }
  | {
      kind: "confirm";
      id: string;
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      onConfirm: () => void;
      onCancel?: () => void;
    }
  | null;

const [modalState, setModalState] = createSignal<ModalState>(null);

/**
 * Show a modal with the given id, title, and HTML content.
 */
export function showModal(id: string, title: string, content: string): void {
  setModalState({ kind: "html", id, title, content });
}

/**
 * Show a confirm/cancel modal. Resolves the user's choice via callbacks.
 * Both callbacks close the modal first, then run.
 */
export function showConfirmModal(opts: {
  id: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  setModalState({
    kind: "confirm",
    id: opts.id,
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel ?? "OK",
    cancelLabel: opts.cancelLabel ?? "Cancel",
    onConfirm: opts.onConfirm,
    onCancel: opts.onCancel,
  });
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
          <Switch>
            <Match when={state().kind === "html"}>
              {(() => {
                const s = state() as Extract<
                  NonNullable<ModalState>,
                  { kind: "html" }
                >;
                return (
                  <HtmlModal
                    id={s.id}
                    title={s.title}
                    content={s.content}
                    onClose={() => setModalState(null)}
                    onOverlayRegister={pushOverlay}
                  />
                );
              })()}
            </Match>
            <Match when={state().kind === "confirm"}>
              {(() => {
                const s = state() as Extract<
                  NonNullable<ModalState>,
                  { kind: "confirm" }
                >;
                const cancel = () => {
                  setModalState(null);
                  s.onCancel?.();
                };
                const confirm = () => {
                  setModalState(null);
                  s.onConfirm();
                };
                return (
                  <Modal
                    id={s.id}
                    title={s.title}
                    onClose={cancel}
                    onOverlayRegister={pushOverlay}
                  >
                    <p class="modal-confirm-message">{s.message}</p>
                    <div class="modal-confirm-actions">
                      <button
                        class="modal-confirm-cancel"
                        onClick={cancel}
                      >
                        {s.cancelLabel}
                      </button>
                      <button
                        class="modal-confirm-ok"
                        onClick={confirm}
                      >
                        {s.confirmLabel}
                      </button>
                    </div>
                  </Modal>
                );
              })()}
            </Match>
          </Switch>
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
