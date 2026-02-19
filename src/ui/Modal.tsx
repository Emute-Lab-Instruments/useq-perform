import { Show, onMount, onCleanup, type JSX } from "solid-js";
import { sanitizeHtml } from "../utils/sanitize";
import { pushOverlay } from "./overlayManager";

export type ModalProps = {
  id?: string;
  title: string;
  onClose: () => void;
  children: JSX.Element;
};

export function Modal(props: ModalProps) {
  let modalRef: HTMLDivElement | undefined;
  let focusableElements: HTMLElement[] = [];

  const getFocusableElements = (): HTMLElement[] => {
    if (!modalRef) return [];
    const selector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(modalRef.querySelectorAll(selector)).filter(
      (el) => !el.hasAttribute("disabled")
    ) as HTMLElement[];
  };

  // Tab-trap handler remains local — it is a focus-management concern, not
  // an overlay-stack concern.
  const handleTabKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement as HTMLElement;

    if (e.shiftKey) {
      // Shift+Tab - cycle backwards
      if (activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab - cycle forwards
      if (activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleTabKey);

    // Get focusable elements and focus the first one
    focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleTabKey);
  });

  // Register with the overlay manager for Escape handling and scroll lock.
  let popOverlay: (() => void) | undefined;
  onMount(() => {
    popOverlay = pushOverlay(props.id ?? "modal", () => props.onClose());
  });
  onCleanup(() => {
    popOverlay?.();
  });

  // Inherit theme class from document root
  const themeClass = () => {
    const root = document.documentElement.className;
    if (root.includes("cm-theme-light")) return "cm-theme-light";
    if (root.includes("cm-theme-dark")) return "cm-theme-dark";
    return "";
  };

  const titleId = () => (props.id ? `${props.id}-title` : "modal-title");

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
        ref={modalRef}
        class={`modal ${themeClass()}`}
        id={props.id}
        style={{ display: "block", "z-index": 1001 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId()}
      >
        <div class="modal-header">
          <h3 class="modal-title" id={titleId()}>
            {props.title}
          </h3>
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
      <div innerHTML={sanitizeHtml(props.content)} />
    </Modal>
  );
}
