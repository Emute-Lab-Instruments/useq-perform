import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { HtmlModal } from "../ui/Modal";

type ModalState = {
  id: string;
  title: string;
  content: string;
} | null;

type API = {
  showModal: (id: string, title: string, content: string) => void;
  closeModal: (id: string) => void;
};

declare global {
  interface Window {
    __solidModal?: API;
  }
}

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

const root = ensureRootElement();

const [modalState, setModalState] = createSignal<ModalState>(null);

function showModal(id: string, title: string, content: string) {
  setModalState({ id, title, content });
}

function closeModal(_id: string) {
  setModalState(null);
}

window.__solidModal = {
  showModal,
  closeModal,
};

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
  root,
);
