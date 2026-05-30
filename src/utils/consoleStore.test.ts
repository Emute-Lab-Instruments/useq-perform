import { describe, it, expect, beforeEach } from "vitest";
import {
  consoleStore,
  addConsoleMessage,
  clearConsole,
  postToConsole,
  setConsoleStore,
} from "./consoleStore";

describe("consoleStore", () => {
  beforeEach(() => {
    clearConsole();
    setConsoleStore("nextId", 1);
  });

  it("starts with empty messages", () => {
    expect(consoleStore.messages).toHaveLength(0);
  });

  it("adds a log message", () => {
    addConsoleMessage("hello");
    expect(consoleStore.messages).toHaveLength(1);
    expect(consoleStore.messages[0].content).toBe("hello");
    expect(consoleStore.messages[0].type).toBe("log");
  });

  it("adds typed messages (error, warn, wasm)", () => {
    addConsoleMessage("err", "error");
    addConsoleMessage("warning", "warn");
    addConsoleMessage("wasm msg", "wasm");

    expect(consoleStore.messages).toHaveLength(3);
    expect(consoleStore.messages[0].type).toBe("error");
    expect(consoleStore.messages[1].type).toBe("warn");
    expect(consoleStore.messages[2].type).toBe("wasm");
  });

  it("increments message IDs", () => {
    addConsoleMessage("first");
    addConsoleMessage("second");

    expect(consoleStore.messages[0].id).toBe(1);
    expect(consoleStore.messages[1].id).toBe(2);
  });

  it("adds timestamps", () => {
    const before = Date.now();
    addConsoleMessage("timed");
    const after = Date.now();

    expect(consoleStore.messages[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(consoleStore.messages[0].timestamp).toBeLessThanOrEqual(after);
  });

  it("clears all messages", () => {
    addConsoleMessage("a");
    addConsoleMessage("b");
    clearConsole();

    expect(consoleStore.messages).toHaveLength(0);
  });

  it("postToConsole is a convenience for log messages", () => {
    postToConsole("posted");

    expect(consoleStore.messages).toHaveLength(1);
    expect(consoleStore.messages[0].type).toBe("log");
    expect(consoleStore.messages[0].content).toBe("posted");
  });

  it("escapes raw HTML on every entry point (console.md §1.4)", () => {
    // addConsoleMessage and postToConsole previously stored content verbatim;
    // all entry points must now escape unsafe HTML.
    addConsoleMessage("<img src=x onerror=alert(1)>");
    postToConsole("<script>evil()</script>");

    expect(consoleStore.messages[0].content).not.toContain("<img");
    expect(consoleStore.messages[0].content).toContain("&lt;img");
    expect(consoleStore.messages[1].content).not.toContain("<script>");
    expect(consoleStore.messages[1].content).toContain("&lt;script&gt;");
  });

  it("renders inline markdown (bold/italic/code) through every entry point", () => {
    addConsoleMessage("**bold** and `code`");
    expect(consoleStore.messages[0].content).toBe(
      "<strong>bold</strong> and <code>code</code>",
    );
  });

  it("caps messages at MAX_CONSOLE_LINES (1000)", () => {
    for (let i = 0; i < 1010; i++) {
      addConsoleMessage(`msg ${i}`);
    }
    expect(consoleStore.messages.length).toBeLessThanOrEqual(1000);
    // The oldest messages should have been trimmed
    expect(consoleStore.messages[0].content).toBe("msg 10");
  });
});
