import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConsolePanel } from "./ConsolePanel";
import {
  consoleStore,
  addConsoleMessage,
  clearConsole,
  setConsoleStore,
} from "../../utils/consoleStore.ts";
import { PERSISTENCE_KEYS } from "../../lib/persistence.ts";

const LAYOUT_KEY = PERSISTENCE_KEYS.consoleLayout;

describe("ConsolePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", window.location.pathname);
    clearConsole();
    setConsoleStore("nextId", 1);
  });

  it("renders the filter row with the four type toggles and a search box", () => {
    render(() => <ConsolePanel />);
    for (const t of ["log", "warn", "error", "wasm"]) {
      expect(screen.getByRole("button", { name: t })).toBeTruthy();
    }
    expect(screen.getByLabelText("Search console")).toBeTruthy();
  });

  it("renders all store messages by default", () => {
    addConsoleMessage("hello", "log");
    addConsoleMessage("careful", "warn");
    addConsoleMessage("boom", "error");
    render(() => <ConsolePanel />);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("careful")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("hides entries of a toggled-off type without dropping them from the store", () => {
    addConsoleMessage("hello", "log");
    addConsoleMessage("boom", "error");
    render(() => <ConsolePanel />);
    fireEvent.click(screen.getByRole("button", { name: "log" }));
    expect(screen.queryByText("hello")).toBeNull();
    expect(screen.getByText("boom")).toBeTruthy();
    // View-only: the store keeps every message.
    expect(consoleStore.messages).toHaveLength(2);
  });

  it("shows a match count while filtering", () => {
    addConsoleMessage("one", "log");
    addConsoleMessage("two", "log");
    addConsoleMessage("boom", "error");
    render(() => <ConsolePanel />);
    expect(screen.queryByText("2/3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "error" }));
    expect(screen.getByText("2/3")).toBeTruthy();
  });

  it("filters case-insensitively on stripped text via the search box", () => {
    addConsoleMessage("**Bold** intro", "log");
    addConsoleMessage("plain text", "log");
    render(() => <ConsolePanel />);
    const input = screen.getByLabelText("Search console") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "BOLD" } });
    expect(screen.getByText(/intro/)).toBeTruthy();
    expect(screen.queryByText("plain text")).toBeNull();
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("shows a no-matches empty state when the query filters everything out", () => {
    addConsoleMessage("hello", "log");
    render(() => <ConsolePanel />);
    const input = screen.getByLabelText("Search console") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "zzz" } });
    expect(screen.getByText("no matching entries")).toBeTruthy();
  });

  it("copies the entry's stripped text via the hover copy affordance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    addConsoleMessage("**Bold** intro", "log");
    render(() => <ConsolePanel />);
    const copyBtn = screen.getAllByTitle("Copy text")[0];
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Bold intro"));
  });

  it("restores persisted geometry clamped to the viewport and MIN sizes", () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ w: 5000, h: -10, x: -30, y: 9999 }),
    );
    const { container } = render(() => <ConsolePanel />);
    const panel = container.querySelector<HTMLElement>(".console-panel")!;
    expect(panel.classList.contains("console-panel--positioned")).toBe(true);
    expect(panel.style.width).toBe("1024px"); // clamped to viewport width
    expect(panel.style.height).toBe("120px"); // clamped to MIN_H
    expect(panel.style.left).toBe("0px"); // clamped into the viewport
    expect(panel.style.top).toBe("648px"); // vh(768) - clamped height
  });

  it("restores collapsed state from the persisted layout", () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ collapsed: true }),
    );
    const { container } = render(() => <ConsolePanel />);
    const panel = container.querySelector<HTMLElement>(".console-panel")!;
    const tab = container.querySelector<HTMLElement>(".console-collapsed-tab")!;
    expect(panel.classList.contains("console-panel--hidden")).toBe(true);
    expect(tab.classList.contains("console-collapsed-tab--hidden")).toBe(false);
  });

  it("restores filter toggles from the persisted layout", () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ filters: { log: false } }),
    );
    addConsoleMessage("hello", "log");
    addConsoleMessage("boom", "error");
    render(() => <ConsolePanel />);
    expect(screen.queryByText("hello")).toBeNull();
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("persists filter changes through the layout key (debounced)", async () => {
    render(() => <ConsolePanel />);
    fireEvent.click(screen.getByRole("button", { name: "warn" }));
    await waitFor(
      () => {
        const stored = JSON.parse(window.localStorage.getItem(LAYOUT_KEY)!);
        expect(stored.filters.warn).toBe(false);
      },
      { timeout: 1000 },
    );
  });

  it("does not persist layout under ?nosave", async () => {
    window.history.replaceState(null, "", "?nosave");
    render(() => <ConsolePanel />);
    fireEvent.click(screen.getByRole("button", { name: "warn" }));
    await new Promise((r) => setTimeout(r, 400));
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBeNull();
  });
});
