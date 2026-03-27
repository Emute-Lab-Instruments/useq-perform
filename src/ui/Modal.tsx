import { Show, onMount, onCleanup, type JSX } from "solid-js";
import { sanitizeHtml } from "../utils/sanitize";

/**
 * Optional overlay registration callback.
 *
 * When provided, Modal calls this on mount with its id and escape handler.
 * The function should return a cleanup callback that removes the overlay.
 *
 * In the adapter layer, pass `pushOverlay` from `./overlayManager` here.
 * When omitted, Modal renders as a pure UI component without overlay-stack
 * integration (no Escape handling via the overlay manager, no scroll lock).
 */
export type OverlayRegisterFn = (
  id: string,
  onEscape: () => void
) => () => void;

export type ModalProps = {
  id?: string;
  title: string;
  onClose: () => void;
  children: JSX.Element;
  /** Register this modal with an overlay manager (for Escape handling / scroll lock). */
  onOverlayRegister?: OverlayRegisterFn;
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

  // Register with the overlay manager for Escape handling and scroll lock,
  // but only when the caller provides the registration callback.
  let popOverlay: (() => void) | undefined;
  onMount(() => {
    if (props.onOverlayRegister) {
      popOverlay = props.onOverlayRegister(
        props.id ?? "modal",
        () => props.onClose()
      );
    }
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
  /** Register this modal with an overlay manager (for Escape handling / scroll lock). */
  onOverlayRegister?: OverlayRegisterFn;
};

export function HtmlModal(props: HtmlModalProps) {
  return (
    <Modal
      id={props.id}
      title={props.title}
      onClose={props.onClose}
      onOverlayRegister={props.onOverlayRegister}
    >
      <div innerHTML={sanitizeHtml(props.content)} />
    </Modal>
  );
}
