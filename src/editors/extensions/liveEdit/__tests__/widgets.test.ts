import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";

import { buildDecorations } from "../widgets.ts";
import type { LiveEditSlot } from "../../../../contracts/liveEdit.ts";

function makeSlot(overrides: Partial<LiveEditSlot> = {}): LiveEditSlot {
  return {
    id: "ab12",
    kind: "numeric",
    seed: 0.5,
    value: 0.5,
    min: 0,
    max: 1,
    state: "idle",
    range: { from: 0, to: 20 },
    modified: false,
    ...overrides,
  };
}

function decoCount(decoSet: ReturnType<typeof buildDecorations>): number {
  let count = 0;
  decoSet.between(0, Infinity, () => {
    count++;
  });
  return count;
}

describe("buildDecorations — single-line invariant", () => {
  it("accepts a single-line slot", () => {
    const doc = Text.of(["(live-edit 0.5 :id \"abc\")"]);
    const slot = makeSlot({ range: { from: 0, to: 24 } });
    const deco = buildDecorations([slot], doc);
    expect(decoCount(deco)).toBe(1);
  });

  it("rejects a multi-line slot spanning two lines", () => {
    const doc = Text.of(["(live-edit", "  0.5 :id \"abc\")"]);
    // from on line 1, to on line 2
    const slot = makeSlot({ range: { from: 0, to: 30 } });
    const deco = buildDecorations([slot], doc);
    expect(decoCount(deco)).toBe(0);
  });

  it("accepts multiple single-line slots, rejects multi-line ones", () => {
    // Line 1: pos 0–30 (text) + newline at 30; line.to = 31
    // Line 2: pos 31–61 (text) + newline at 61; line.to = 62
    // Line 3: pos 62–91 (text); line.to = 92
    const doc = Text.of([
      "(a1 (live-edit 0.5 :id \"a\"))",
      "(a2 (live-edit 0.8 :id \"b\"))",
      "(a3 (live-edit 0.5 :id \"c\"))",
    ]);
    const good1 = makeSlot({
      id: "a",
      range: { from: 4, to: 27 }, // entirely on line 1
    });
    const bad = makeSlot({
      id: "b",
      range: { from: 28, to: 35 }, // line 1 (28) → line 2 (35)
    });
    const good2 = makeSlot({
      id: "c",
      range: { from: 66, to: 89 }, // entirely on line 3
    });
    const deco = buildDecorations([good1, bad, good2], doc);
    expect(decoCount(deco)).toBe(2);
  });

  it("handles slot ending at exact line boundary", () => {
    // Slot ends at the exclusive end of line 1 (no newline included)
    const doc = Text.of(["(live-edit 0.5 :id \"abc\")", "(next)"]);
    const line1End = doc.lineAt(0).to; // exclusive end of line 1
    const slot = makeSlot({ range: { from: 0, to: line1End } });
    const deco = buildDecorations([slot], doc);
    expect(decoCount(deco)).toBe(1);
  });

  it("rejects slot starting on one line and ending on the next", () => {
    const doc = Text.of(["before (live-edit", "0.5 :id \"x\") after"]);
    // from on line 1, to on line 2
    const slot = makeSlot({
      id: "x",
      range: { from: 7, to: 28 },
    });
    const deco = buildDecorations([slot], doc);
    expect(decoCount(deco)).toBe(0);
  });
});
