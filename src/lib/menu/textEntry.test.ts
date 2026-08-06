import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplyTarget, MenuInput, MenuStateT9 } from "./types";
import { createTextEntryController, T9_COMMIT_TIMEOUT_MS } from "./textEntry";

function t9State(caseMode: "lower" | "upper" = "lower"): MenuStateT9 {
  return {
    phase: "t9",
    buffer: "",
    lastKey: null,
    lastKeyAt: 0,
    caseMode,
    target: {} as ApplyTarget,
    returnTo: "closed",
    activeVerb: { kind: "insert", hand: "left" },
  };
}

describe("text-entry controller", () => {
  let state: MenuStateT9;
  let inputs: MenuInput[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(12);
    state = t9State();
    inputs = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function controller() {
    return createTextEntryController({
      getMenuState: () => state,
      dispatchInput: (input) => inputs.push(input),
    });
  }

  it("maps numpad hover to the insert face action", () => {
    const subject = controller();
    const numpad = { ...state, phase: "numpad" as const };

    subject.handleAxis(numpad, "left", 2);
    subject.handleVerbAction(numpad, "menu.verb.insert");

    expect(inputs).toEqual([{ kind: "subModeAppend", char: "3" }]);
  });

  it("cycles the active T9 key by replacing the trailing character", () => {
    const subject = controller();
    subject.handleAxis(state, "left", 1);

    subject.handleVerbAction(state, "menu.verb.insert");
    subject.handleVerbAction(state, "menu.verb.insert");

    expect(inputs.map((input) => input.kind)).toEqual([
      "subModeAppend",
      "subModeT9Cycle",
      "subModeBackspace",
      "subModeAppend",
      "subModeT9Cycle",
    ]);
    expect(inputs.filter((input) => input.kind === "subModeAppend")).toEqual([
      { kind: "subModeAppend", char: "a" },
      { kind: "subModeAppend", char: "b" },
    ]);
  });

  it("commits the previous T9 key before starting another", () => {
    const subject = controller();
    subject.handleAxis(state, "left", 1);
    subject.handleVerbAction(state, "menu.verb.insert");
    subject.handleAxis(state, "left", 2);
    subject.handleVerbAction(state, "menu.verb.insert");

    expect(inputs.map((input) => input.kind)).toEqual([
      "subModeAppend",
      "subModeT9Cycle",
      "subModeT9IdleCommit",
      "subModeAppend",
      "subModeT9Cycle",
    ]);
  });

  it("commits a pending T9 character after the idle timeout", () => {
    const subject = controller();
    subject.handleAxis(state, "left", 1);
    subject.handleVerbAction(state, "menu.verb.insert");

    vi.advanceTimersByTime(T9_COMMIT_TIMEOUT_MS);

    expect(inputs.at(-1)).toEqual({ kind: "subModeT9IdleCommit", ts: 12 });
  });

  it("reset cancels pending T9 work", () => {
    const subject = controller();
    subject.handleAxis(state, "left", 1);
    subject.handleVerbAction(state, "menu.verb.insert");
    subject.reset();

    vi.advanceTimersByTime(T9_COMMIT_TIMEOUT_MS);

    expect(inputs.some((input) => input.kind === "subModeT9IdleCommit")).toBe(false);
  });
});
