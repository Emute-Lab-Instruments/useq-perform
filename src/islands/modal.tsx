import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { HtmlModal } from "../ui/Modal";

type ModalState = {
  id: string;
  title: string;
  content: string;
} | null;


function ensureRootElement() {
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

const [modalState, setModalState] = createSignal<ModalState>(null);

function showModal(id: string, title: string, content: string) {
  setModalState({ id, title, content });
}

function closeModal(_id: string) {
  setModalState(null);
}

export { showModal, closeModal };

export function mountModal(root?: HTMLElement) {
  const el = root || ensureRootElement();
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

// Auto-mount for backward compatibility (islands are still loaded as separate scripts)
if (typeof document !== "undefined" && typeof document.body !== "undefined") {
  try {
    mountModal();
  } catch (_) {
    // Ignore in non-browser environments (e.g. Node.js tests)
  }
}
