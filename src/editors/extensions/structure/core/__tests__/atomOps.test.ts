import { describe, it, expect } from "vitest";
import { adjustNumber, flipPolarity, atomAdjust, toggleBoolean } from "../atomOps.ts";
import { cycleSymbol, cycleKeyword } from "../cycleGroups.ts";

describe("adjustNumber", () => {
  it("increments an integer by 1", () => {
    const r = adjustNumber("5", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "6" });
  });

  it("decrements an integer by 1", () => {
    const r = adjustNumber("5", -1);
    expect(r).toEqual({ kind: "adjusted", newText: "4" });
  });

  it("uses precision-based step for floats (0.5 → step 0.1)", () => {
    const r = adjustNumber("0.5", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "0.6" });
  });

  it("preserves trailing zeros (0.50 → 0.51, step=0.01)", () => {
    const r = adjustNumber("0.50", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "0.51" });
  });

  it("step for 0.25 is 0.01", () => {
    const r = adjustNumber("0.25", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "0.26" });
  });

  it("decrements past zero into negatives", () => {
    const r = adjustNumber("0", -1);
    expect(r).toEqual({ kind: "adjusted", newText: "-1" });
  });

  it("increments negative floats", () => {
    const r = adjustNumber("-0.5", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "-0.4" });
  });

  it("returns no-op for non-numeric text", () => {
    const r = adjustNumber("foo", 1);
    expect(r.kind).toBe("no-op");
  });
});

describe("flipPolarity", () => {
  it("flips positive to negative", () => {
    expect(flipPolarity("5")).toEqual({ kind: "adjusted", newText: "-5" });
  });

  it("flips negative to positive", () => {
    expect(flipPolarity("-3.14")).toEqual({ kind: "adjusted", newText: "3.14" });
  });

  it("preserves decimal formatting", () => {
    expect(flipPolarity("-0.50")).toEqual({ kind: "adjusted", newText: "0.50" });
  });

  it("no-ops on zero", () => {
    expect(flipPolarity("0")).toEqual({ kind: "no-op", reason: "zero" });
  });

  it("no-ops on 0.0", () => {
    expect(flipPolarity("0.0")).toEqual({ kind: "no-op", reason: "zero" });
  });
});

describe("toggleBoolean", () => {
  it("flips true to false", () => {
    expect(toggleBoolean("true")).toEqual({ kind: "adjusted", newText: "false" });
  });

  it("flips false to true", () => {
    expect(toggleBoolean("false")).toEqual({ kind: "adjusted", newText: "true" });
  });

  it("no-ops on non-boolean", () => {
    expect(toggleBoolean("foo").kind).toBe("no-op");
  });
});

describe("cycleSymbol", () => {
  it("cycles sin → cos (next in waveshapes group)", () => {
    const r = cycleSymbol("sin", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe("cos");
  });

  it("cycles cos → sin (prev in waveshapes group)", () => {
    const r = cycleSymbol("cos", -1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe("sin");
  });

  it("wraps: pulse → sin (end wraps to start)", () => {
    const r = cycleSymbol("pulse", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe("sin");
  });

  it("wraps backward: sin → pulse (start wraps to end)", () => {
    const r = cycleSymbol("sin", -1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe("pulse");
  });

  it("normalizes aliases: seq → from-list", () => {
    const r = cycleSymbol("seq", 1);
    expect(r.kind).toBe("alias-normalized");
    if (r.kind === "alias-normalized") expect(r.newValue).toBe("from-list");
  });

  it("returns no-group for unknown symbols", () => {
    expect(cycleSymbol("my-custom-fn", 1)).toEqual({ kind: "no-group" });
  });

  it("cycles arithmetic operators", () => {
    const r = cycleSymbol("+", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe("-");
  });
});

describe("cycleKeyword", () => {
  it("cycles :sin → :tri", () => {
    const r = cycleKeyword(":sin", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe(":tri");
  });

  it("wraps: :sqr → :sin", () => {
    const r = cycleKeyword(":sqr", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newValue).toBe(":sin");
  });

  it("returns no-group for unknown keywords", () => {
    expect(cycleKeyword(":custom", 1)).toEqual({ kind: "no-group" });
  });
});

describe("atomAdjust (top-level dispatch)", () => {
  it("dispatches number kind to adjustNumber", () => {
    const r = atomAdjust("5", "number", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "6" });
  });

  it("dispatches symbol kind — boolean toggle", () => {
    const r = atomAdjust("true", "symbol", 1);
    expect(r).toEqual({ kind: "adjusted", newText: "false" });
  });

  it("dispatches symbol kind — cycle group", () => {
    const r = atomAdjust("sin", "symbol", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newText).toBe("cos");
  });

  it("dispatches keyword kind", () => {
    const r = atomAdjust(":sin", "keyword", 1);
    expect(r.kind).toBe("cycled");
    if (r.kind === "cycled") expect(r.newText).toBe(":tri");
  });

  it("returns no-op for string kind", () => {
    const r = atomAdjust("\"hello\"", "string", 1);
    expect(r.kind).toBe("no-op");
  });

  it("returns no-op for ungrouped symbol", () => {
    const r = atomAdjust("my-fn", "symbol", 1);
    expect(r.kind).toBe("no-op");
  });
});
