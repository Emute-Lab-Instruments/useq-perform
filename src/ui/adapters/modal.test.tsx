import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { ModalRoot, closeModal, confirmDialog, showModal } from "./modal";
import { _resetForTesting } from "../overlayManager";

afterEach(() => {
  closeModal("any");
  _resetForTesting();
});

describe("confirmDialog", () => {
  it("resolves true when the confirm button is clicked", async () => {
    render(() => <ModalRoot />);
    const result = confirmDialog({ title: "Apply?", message: "Apply config", confirmLabel: "Apply" });

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Apply config")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await expect(result).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false on cancel", async () => {
    render(() => <ModalRoot />);
    const result = confirmDialog({ title: "Apply?", message: "m" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBe(false);
  });

  it("resolves false on Escape via the overlay stack", async () => {
    render(() => <ModalRoot />);
    const result = confirmDialog({ title: "Apply?", message: "m" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(result).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false when the close button is clicked", async () => {
    render(() => <ModalRoot />);
    const result = confirmDialog({ title: "Apply?", message: "m" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await expect(result).resolves.toBe(false);
  });

  it("focuses the confirm button for non-destructive confirms", () => {
    render(() => <ModalRoot />);
    void confirmDialog({ title: "Apply?", message: "m", confirmLabel: "Apply" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
  });

  it("focuses the safe button and styles confirm as destructive", () => {
    render(() => <ModalRoot />);
    void confirmDialog({ title: "Delete?", message: "m", confirmLabel: "Delete", destructive: true });
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del.classList.contains("modal-confirm-destructive")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("resolves false when replaced by another modal (single-modal rule)", async () => {
    render(() => <ModalRoot />);
    const first = confirmDialog({ title: "First", message: "first message" });
    showModal("other", "Other", "<p>other body</p>");

    await expect(first).resolves.toBe(false);
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.queryByText("first message")).toBeNull();
  });

  it("renders the replacing confirm's content", async () => {
    render(() => <ModalRoot />);
    const first = confirmDialog({ title: "First", message: "first message" });
    const second = confirmDialog({ title: "Second", message: "second message", confirmLabel: "Yes" });

    await expect(first).resolves.toBe(false);
    expect(screen.getByText("second message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await expect(second).resolves.toBe(true);
  });
});
