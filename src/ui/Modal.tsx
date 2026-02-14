import { Show, onMount, onCleanup, type JSX } from "solid-js";

export type ModalProps = {
  id?: string;
  title: string;
  onClose: () => void;
  children: JSX.Element;
};

export function Modal(props: ModalProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Inherit theme class from document root
  const themeClass = () => {
    const root = document.documentElement.className;
    if (root.includes("cm-theme-light")) return "cm-theme-light";
    if (root.includes("cm-theme-dark")) return "cm-theme-dark";
    return "";
  };

  return (
    <>
      <div
        class="modal-overlay"
        id={props.id ? `${props.id}-overlay` : undefined}
        style={{ display: "block", "z-index": 1000 }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      />
      <div
        class={`modal ${themeClass()}`}
        id={props.id}
        style={{ display: "block", "z-index": 1001 }}
        role="dialog"
        aria-modal="true"
      >
        <div class="modal-header">
          <h3 class="modal-title">{props.title}</h3>
          <button class="modal-close" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div class="modal-body">{props.children}</div>
      </div>
    </>
  );
}

export type HtmlModalProps = {
  id?: string;
  title: string;
  content: string;
  onClose: () => void;
};

export function HtmlModal(props: HtmlModalProps) {
  return (
    <Modal id={props.id} title={props.title} onClose={props.onClose}>
      <div innerHTML={props.content} />
    </Modal>
  );
}
