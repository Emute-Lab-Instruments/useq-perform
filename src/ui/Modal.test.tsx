import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Modal, HtmlModal } from "./Modal";
import { _resetForTesting } from "./overlayManager";

afterEach(() => {
  _resetForTesting();
});

describe("Modal", () => {
  it("renders title text", () => {
    render(() => (
      <Modal title="Warning" onClose={() => {}}>
        <p>Something happened</p>
      </Modal>
    ));
    expect(screen.getByText("Warning")).toBeTruthy();
  });

  it("renders children content", () => {
    render(() => (
      <Modal title="Test" onClose={() => {}}>
        <p data-testid="body">Modal body</p>
      </Modal>
    ));
    expect(screen.getByTestId("body").textContent).toBe("Modal body");
  });

  it("renders with dialog role and aria-modal", () => {
    const { container } = render(() => (
      <Modal title="Test" onClose={() => {}}>
        <p>content</p>
      </Modal>
    ));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("renders an overlay", () => {
    const { container } = render(() => (
      <Modal title="Test" onClose={() => {}}>
        <p>content</p>
      </Modal>
    ));
    expect(container.querySelector(".modal-overlay")).toBeTruthy();
  });

  it("applies custom id to modal and overlay", () => {
    const { container } = render(() => (
      <Modal id="my-modal" title="Test" onClose={() => {}}>
        <p>content</p>
      </Modal>
    ));
    expect(container.querySelector("#my-modal")).toBeTruthy();
    expect(container.querySelector("#my-modal-overlay")).toBeTruthy();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(() => (
      <Modal title="Test" onClose={onClose}>
        <p>content</p>
      </Modal>
    ));
    const closeBtn = screen.getByText("\u00D7"); // multiplication sign ×
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(() => (
      <Modal title="Test" onClose={onClose}>
        <p>content</p>
      </Modal>
    ));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when clicking overlay background", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal title="Test" onClose={onClose}>
        <p>content</p>
      </Modal>
    ));
    const overlay = container.querySelector(".modal-overlay")!;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has z-index above overlay", () => {
    const { container } = render(() => (
      <Modal title="Test" onClose={() => {}}>
        <p>content</p>
      </Modal>
    ));
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    const modal = container.querySelector(".modal") as HTMLElement;
    const overlayZ = parseInt(overlay.style.zIndex);
    const modalZ = parseInt(modal.style.zIndex);
    expect(modalZ).toBeGreaterThan(overlayZ);
  });
});

describe("HtmlModal", () => {
  it("renders HTML content from string", () => {
    const { container } = render(() => (
      <HtmlModal
        title="HTML Modal"
        content="<p>This is <strong>bold</strong> content</p>"
        onClose={() => {}}
      />
    ));
    const body = container.querySelector(".modal-body");
    expect(body?.innerHTML).toContain("<strong>bold</strong>");
  });

  it("renders title via parent Modal", () => {
    render(() => (
      <HtmlModal
        title="My Title"
        content="<p>Body</p>"
        onClose={() => {}}
      />
    ));
    expect(screen.getByText("My Title")).toBeTruthy();
  });
});
