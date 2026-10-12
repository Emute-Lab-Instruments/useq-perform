import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "../../contracts/toastChannels";
import { ToastRoot, toastStore } from "../adapters/toast";
import { DEFAULT_TOAST_DURATION_MS, MAX_VISIBLE_TOASTS } from "./toastStore";
import { pushOverlay, _resetForTesting } from "../overlayManager";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  toastStore.clear();
  _resetForTesting();
  vi.useRealTimers();
});

describe("toast surface", () => {
  it("renders a notify() call with polite status semantics", () => {
    render(() => <ToastRoot />);
    notify({ message: "Saved", kind: "success" });

    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Saved");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.classList.contains("toast--success")).toBe(true);
  });

  it("uses assertive alert semantics for errors", () => {
    render(() => <ToastRoot />);
    notify({ message: "Boom", kind: "error" });
    const toast = screen.getByRole("alert");
    expect(toast.getAttribute("aria-live")).toBe("assertive");
  });

  it("auto-dismisses after the per-kind default", () => {
    render(() => <ToastRoot />);
    notify({ message: "Hello" });
    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS.info - 1);
    expect(screen.queryByText("Hello")).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("keeps errors visible longer than info toasts", () => {
    expect(DEFAULT_TOAST_DURATION_MS.error).toBeGreaterThan(DEFAULT_TOAST_DURATION_MS.info);
  });

  it("durationMs: 0 makes a toast sticky", () => {
    render(() => <ToastRoot />);
    notify({ message: "Sticky", durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(screen.queryByText("Sticky")).toBeTruthy();
  });

  it("dismisses via the labelled dismiss button", () => {
    render(() => <ToastRoot />);
    notify({ message: "Bye", durationMs: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Bye")).toBeNull();
  });

  it("runs the action and dismisses the toast", () => {
    const run = vi.fn();
    render(() => <ToastRoot />);
    notify({ message: "Moved", action: { label: "Undo", run } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText("Moved")).toBeNull();
  });

  it("caps the stack, evicting the oldest", () => {
    render(() => <ToastRoot />);
    for (let i = 0; i <= MAX_VISIBLE_TOASTS; i++) notify({ message: `t${i}` });
    expect(screen.getAllByRole("status")).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.queryByText("t0")).toBeNull();
    expect(screen.queryByText(`t${MAX_VISIBLE_TOASTS}`)).toBeTruthy();
  });

  it("does not take focus", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    render(() => <ToastRoot />);
    notify({ message: "Quiet", action: { label: "Act", run: () => {} } });
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("is not on the overlay stack: Escape still reaches the topmost overlay", () => {
    const onEscape = vi.fn();
    render(() => <ToastRoot />);
    pushOverlay("panel", onEscape);
    notify({ message: "Hi", durationMs: 0 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).toHaveBeenCalledOnce();
    expect(screen.queryByText("Hi")).toBeTruthy();
  });
});
