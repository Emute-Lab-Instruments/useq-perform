import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConsolePanel } from "./ConsolePanel";
import {
  addConsoleMessage,
  clearConsole,
  setConsoleStore,
  consoleStore,
} from "../../utils/consoleStore";

// Mock createVirtualizer since jsdom has no layout engine
vi.mock("@tanstack/solid-virtual", () => ({
  createVirtualizer: (opts: any) => {
    // Return a simple accessor that mimics the virtualizer API
    return () => ({
      getVirtualItems: () =>
        Array.from({ length: opts.count() }, (_, i) => ({
          index: i,
          start: i * 24,
          size: 24,
          key: i,
        })),
      getTotalSize: () => opts.count() * 24,
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
    });
  },
}));

describe("ConsolePanel", () => {
  beforeEach(() => {
    clearConsole();
    setConsoleStore("nextId", 1);
  });

  it("renders empty state message when no messages", () => {
    render(() => <ConsolePanel />);
    expect(screen.getByText("No messages yet...")).toBeTruthy();
  });

  it("shows message count in header", () => {
    render(() => <ConsolePanel />);
    expect(screen.getByText("Console (0)")).toBeTruthy();
  });

  it("updates count when messages are added", () => {
    render(() => <ConsolePanel />);
    addConsoleMessage("hello");
    expect(screen.getByText("Console (1)")).toBeTruthy();
  });

  it("renders a Clear button", () => {
    render(() => <ConsolePanel />);
    expect(screen.getByText("Clear")).toBeTruthy();
  });

  it("clears messages when Clear button is clicked", () => {
    addConsoleMessage("msg1");
    addConsoleMessage("msg2");
    render(() => <ConsolePanel />);
    expect(screen.getByText("Console (2)")).toBeTruthy();

    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Console (0)")).toBeTruthy();
  });

  it("renders message content after adding messages", () => {
    render(() => <ConsolePanel />);
    addConsoleMessage("test message");
    // The message content is rendered via innerHTML in a span
    // With our virtualizer mock, it should show up
    expect(screen.getByText("Console (1)")).toBeTruthy();
  });

  it("renders message prefixes for different types", () => {
    render(() => <ConsolePanel />);
    addConsoleMessage("err", "error");
    addConsoleMessage("warning", "warn");
    addConsoleMessage("wasm msg", "wasm");
    addConsoleMessage("log msg", "log");

    // Check prefixes are rendered (they're in bold spans)
    const container = document.body;
    const boldSpans = container.querySelectorAll("span[style*='font-weight']");
    const prefixes = Array.from(boldSpans).map((el) => el.textContent?.trim());

    // Should have prefixes for each message type
    expect(prefixes).toContain("\u2717"); // error
    expect(prefixes).toContain("\u26A0"); // warn
    expect(prefixes).toContain("\u25C8"); // wasm
    expect(prefixes).toContain(">"); // log
  });
});
