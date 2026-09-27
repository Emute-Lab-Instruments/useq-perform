/**
 * Modal adapter - imperative modal API.
 *
 * The application root owns rendering; this module owns modal state.
 */
import { Show, createSignal, Switch, Match } from "solid-js";
import { HtmlModal, Modal } from "../Modal";
import { pushOverlay } from "../overlayManager";

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
      secondaryLabel?: string;
      /** Style the confirm button as destructive and focus the cancel button. */
      destructive?: boolean;
      onConfirm: () => void;
      onCancel?: () => void;
      onSecondary?: () => void;
      /** Runs when another modal replaces this one or `closeModal` removes it. */
      onDiscard?: () => void;
    }
  | null;

const [modalState, setModalStateSignal] = createSignal<ModalState>(null);

/**
 * Single writer for the modal-state signal. A confirm that is replaced or
 * closed without a user choice is told so via `onDiscard` (overlays.md §1.5).
 */
function setModalState(next: ModalState): void {
  const prev = modalState();
  setModalStateSignal(next);
  if (prev && prev !== next && prev.kind === "confirm") prev.onDiscard?.();
}

/** Settle a confirm by user choice: clear it without triggering `onDiscard`. */
function settleConfirm(): void {
  setModalStateSignal(null);
}

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
  secondaryLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  onSecondary?: () => void;
  onDiscard?: () => void;
}): void {
  setModalState({
    kind: "confirm",
    id: opts.id,
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel ?? "OK",
    cancelLabel: opts.cancelLabel ?? "Cancel",
    secondaryLabel: opts.secondaryLabel,
    destructive: opts.destructive,
    onConfirm: opts.onConfirm,
    onCancel: opts.onCancel,
    onSecondary: opts.onSecondary,
    onDiscard: opts.onDiscard,
  });
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a danger-styled confirm and focus on Cancel. */
  destructive?: boolean;
  id?: string;
}

export type ConfirmDialogFn = (opts: ConfirmDialogOptions) => Promise<boolean>;

/**
 * In-app replacement for the native `window.confirm` dialog. Resolves `true` on confirm and
 * `false` on cancel, Escape, backdrop click, close button, or when another
 * modal replaces it.
 */
export const confirmDialog: ConfirmDialogFn = (opts) =>
  new Promise<boolean>((resolve) => {
    showConfirmModal({
      id: opts.id ?? "confirm-dialog",
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      destructive: opts.destructive,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onDiscard: () => resolve(false),
    });
  });

/**
 * Close the currently open modal.
 */
export function closeModal(_id: string): void {
  setModalState(null);
}

export function ModalRoot() {
  return (
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
                  settleConfirm();
                  s.onCancel?.();
                };
                const confirm = () => {
                  settleConfirm();
                  s.onConfirm();
                };
                const secondary = () => {
                  settleConfirm();
                  s.onSecondary?.();
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
                      <Show when={s.secondaryLabel}>
                        <button
                          type="button"
                          class="modal-confirm-cancel"
                          onClick={secondary}
                        >
                          {s.secondaryLabel}
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="modal-confirm-cancel"
                        data-autofocus={s.destructive ? "" : undefined}
                        onClick={cancel}
                      >
                        {s.cancelLabel}
                      </button>
                      <button
                        type="button"
                        class="modal-confirm-ok"
                        classList={{ "modal-confirm-destructive": !!s.destructive }}
                        data-autofocus={s.destructive ? undefined : ""}
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
  );
}
