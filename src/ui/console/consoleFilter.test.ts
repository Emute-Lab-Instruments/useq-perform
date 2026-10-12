import { describe, it, expect } from "vitest";
import {
  CONSOLE_TYPES,
  allFiltersOn,
  filterMessages,
  isFilterActive,
  stripHtml,
} from "./consoleFilter.ts";
import type { ConsoleMessage } from "../../utils/consoleStore.ts";

function msg(
  id: number,
  type: ConsoleMessage["type"],
  content: string,
): ConsoleMessage {
  return { id, type, content, timestamp: id * 1000 };
}

describe("consoleFilter", () => {
  it("exposes all four console types", () => {
    expect(CONSOLE_TYPES).toEqual(["log", "warn", "error", "wasm"]);
  });

  it("returns every message when all toggles are on and query is empty", () => {
    const messages = [
      msg(1, "log", "hello"),
      msg(2, "error", "boom"),
      msg(3, "wasm", ";=> 42"),
    ];
    expect(filterMessages(messages, allFiltersOn(), "")).toEqual(messages);
  });

  it("hides messages whose type toggle is off", () => {
    const messages = [
      msg(1, "log", "hello"),
      msg(2, "error", "boom"),
      msg(3, "error", "again"),
    ];
    const filters = { ...allFiltersOn(), error: false };
    expect(filterMessages(messages, filters, "").map((m) => m.id)).toEqual([1]);
  });

  it("matches case-insensitively against stripped text", () => {
    const messages = [
      msg(1, "log", "<strong>Bold</strong> intro"),
      msg(2, "log", "plain text"),
    ];
    expect(filterMessages(messages, allFiltersOn(), "BOLD").map((m) => m.id)).toEqual([1]);
  });

  it("does not match raw markup, only stripped text", () => {
    const messages = [msg(1, "log", "<strong>bold</strong>")];
    expect(filterMessages(messages, allFiltersOn(), "<strong>")).toEqual([]);
    expect(filterMessages(messages, allFiltersOn(), "strong")).toEqual([]);
  });

  it("combines type toggles and query", () => {
    const messages = [
      msg(1, "warn", "careful"),
      msg(2, "error", "careful!"),
      msg(3, "log", "careful too"),
    ];
    const filters = { ...allFiltersOn(), log: false, warn: false };
    expect(filterMessages(messages, filters, "careful").map((m) => m.id)).toEqual([2]);
  });

  it("trims the query", () => {
    const messages = [msg(1, "log", "hello world")];
    expect(filterMessages(messages, allFiltersOn(), "  world  ")).toHaveLength(1);
  });

  it("returns a new array and never mutates the input (view-only)", () => {
    const messages = Object.freeze([msg(1, "log", "hello")]) as ConsoleMessage[];
    const result = filterMessages(messages, allFiltersOn(), "hello");
    expect(result).not.toBe(messages);
    expect(result).toHaveLength(1);
  });

  it("isFilterActive reflects toggles and query", () => {
    expect(isFilterActive(allFiltersOn(), "")).toBe(false);
    expect(isFilterActive({ ...allFiltersOn(), warn: false }, "")).toBe(true);
    expect(isFilterActive(allFiltersOn(), "x")).toBe(true);
    expect(isFilterActive(allFiltersOn(), "   ")).toBe(false);
  });

  it("stripHtml removes inline markup", () => {
    expect(stripHtml("<strong>a</strong> and <em>b</em>")).toBe("a and b");
    expect(stripHtml("plain")).toBe("plain");
  });
});
