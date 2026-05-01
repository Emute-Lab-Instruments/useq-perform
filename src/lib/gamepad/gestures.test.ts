// src/lib/gamepad/gestures.test.ts
//
// Golden tests for the Gesture smart constructors and `keyOf`.
// These are normative — the spec describes what these functions return;
// the tests pin those values down. See docs/specs/gamepad.md §3.2, §4.4.

import { describe, expect, it } from "vitest";

import {
  at,
  chord,
  chordFromArray,
  compareButtons,
  doubleTap,
  flick,
  held,
  hold,
  keyOf,
  tap,
} from "./gestures";
import { BUTTON_ORDER, type ButtonName } from "./types";

// ===========================================================================
// Smart-constructor goldens — output shape per primitive
// ===========================================================================

describe("smart constructors", () => {
  it("tap('A')", () => {
    expect(tap("A")).toEqual({ kind: "tap", btn: "A" });
  });

  it("hold('Start')", () => {
    expect(hold("Start")).toEqual({ kind: "hold", btn: "Start" });
  });

  it("held('Up') defaults n to 1", () => {
    expect(held("Up")).toEqual({ kind: "held", btn: "Up", n: 1 });
  });

  it("held('Up', 5)", () => {
    expect(held("Up", 5)).toEqual({ kind: "held", btn: "Up", n: 5 });
  });

  it("held rejects n < 1", () => {
    expect(() => held("Up", 0)).toThrow(RangeError);
    expect(() => held("Up", -1)).toThrow(RangeError);
  });

  it("held rejects non-integer n", () => {
    expect(() => held("Up", 1.5)).toThrow(RangeError);
  });

  it("doubleTap('A')", () => {
    expect(doubleTap("A")).toEqual({ kind: "doubleTap", btn: "A" });
  });

  it("flick('LeftStick', 'up')", () => {
    expect(flick("LeftStick", "up")).toEqual({
      kind: "flick",
      stick: "LeftStick",
      dir: "up",
    });
  });
});

// ===========================================================================
// Chord canonicalisation — distinct buttons + sorted by BUTTON_ORDER
// ===========================================================================

describe("chord canonicalisation", () => {
  it("two-button chord sorts by BUTTON_ORDER", () => {
    // 'A' is index 0, 'LB' is index 4 → 'A' before 'LB'
    expect(chord(["LB", "A"])).toEqual({
      kind: "chord",
      btns: ["A", "LB"],
    });
  });

  it("is idempotent under reordering of inputs", () => {
    expect(chord(["A", "LB"])).toEqual(chord(["LB", "A"]));
  });

  it("three-button chord canonicalises by BUTTON_ORDER, not lexicographically", () => {
    // BUTTON_ORDER: A(0), Y(3), LB(4) → 'A','Y','LB'
    // Lexicographic would give: 'A','LB','Y' — different!
    expect(chord(["Y", "LB", "A"])).toEqual({
      kind: "chord",
      btns: ["A", "Y", "LB"],
    });
  });

  it("rejects duplicate buttons", () => {
    expect(() => chord(["A", "A"])).toThrow(RangeError);
    expect(() => chord(["A", "LB", "A"])).toThrow(RangeError);
  });

  it("preserves all distinct buttons in canonical order", () => {
    const c = chord(["RightStickPress", "A", "Up", "Start"]);
    // BUTTON_ORDER: A(0), Up(8), Start(12), RightStickPress(15)
    expect(c.btns).toEqual(["A", "Up", "Start", "RightStickPress"]);
  });
});

// ===========================================================================
// chordFromArray — runtime-array chord construction
// ===========================================================================

describe("chordFromArray", () => {
  it("constructs the same gesture as chord(...) for valid inputs", () => {
    const buttons: ButtonName[] = ["LB", "A"];
    expect(chordFromArray(buttons)).toEqual(chord(["LB", "A"]));
  });

  it("rejects arrays of length < 2", () => {
    expect(() => chordFromArray([])).toThrow(RangeError);
    expect(() => chordFromArray(["A"])).toThrow(RangeError);
  });

  it("rejects duplicate buttons", () => {
    expect(() => chordFromArray(["A", "A"])).toThrow(RangeError);
  });

  it("canonicalises by BUTTON_ORDER", () => {
    expect(chordFromArray(["Y", "A", "LB"]).btns).toEqual(["A", "Y", "LB"]);
  });
});

// ===========================================================================
// compareButtons — used for canonical ordering
// ===========================================================================

describe("compareButtons", () => {
  it("orders by BUTTON_ORDER index", () => {
    expect(compareButtons("A", "B")).toBeLessThan(0);
    expect(compareButtons("LB", "A")).toBeGreaterThan(0);
    expect(compareButtons("A", "A")).toBe(0);
  });

  it("the returned ordering matches BUTTON_ORDER", () => {
    const shuffled: typeof BUTTON_ORDER[number][] = [
      "RightStickPress", "Up", "A", "Start", "LB", "Y", "RT",
    ];
    const sorted = [...shuffled].sort(compareButtons);
    // Each element appears in BUTTON_ORDER at a non-decreasing index
    const indices = sorted.map(b => BUTTON_ORDER.indexOf(b));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });
});

// ===========================================================================
// keyOf — canonical string projection
// ===========================================================================

describe("keyOf", () => {
  it("tap → 'tap:<btn>'", () => {
    expect(keyOf(tap("A"))).toBe("tap:A");
    expect(keyOf(tap("Start"))).toBe("tap:Start");
  });

  it("hold → 'hold:<btn>'", () => {
    expect(keyOf(hold("A"))).toBe("hold:A");
  });

  it("held strips n", () => {
    expect(keyOf(held("Up"))).toBe("held:Up");
    expect(keyOf(held("Up", 5))).toBe("held:Up");
    expect(keyOf(held("Up", 999))).toBe("held:Up");
  });

  it("doubleTap → 'doubleTap:<btn>'", () => {
    expect(keyOf(doubleTap("A"))).toBe("doubleTap:A");
  });

  it("chord projects canonicalised buttons", () => {
    expect(keyOf(chord(["LB", "A"]))).toBe("chord:A+LB");
    expect(keyOf(chord(["A", "LB"]))).toBe("chord:A+LB");
  });

  it("chord key is identical regardless of input order", () => {
    expect(keyOf(chord(["Y", "LB", "A"])))
      .toBe(keyOf(chord(["A", "Y", "LB"])));
  });

  it("flick → 'flick:<stick>:<dir>'", () => {
    expect(keyOf(flick("LeftStick", "up"))).toBe("flick:LeftStick:up");
    expect(keyOf(flick("RightStick", "down"))).toBe("flick:RightStick:down");
  });

  it("two structurally-equal gestures have equal keys", () => {
    expect(keyOf(tap("A"))).toBe(keyOf(tap("A")));
    expect(keyOf(chord(["A", "LB"]))).toBe(keyOf(chord(["LB", "A"])));
  });

  it("two structurally-distinct gestures have distinct keys", () => {
    expect(keyOf(tap("A"))).not.toBe(keyOf(hold("A")));
    expect(keyOf(tap("A"))).not.toBe(keyOf(tap("B")));
    expect(keyOf(chord(["A", "LB"]))).not.toBe(keyOf(chord(["A", "RB"])));
    expect(keyOf(flick("LeftStick", "up")))
      .not.toBe(keyOf(flick("LeftStick", "down")));
  });
});

// ===========================================================================
// `at` helper — wraps a gesture with a timestamp
// ===========================================================================

describe("at", () => {
  it("packages a gesture with a timestamp", () => {
    expect(at(tap("A"), 120)).toEqual({
      gesture: { kind: "tap", btn: "A" },
      t: 120,
    });
  });

  it("packages chord events", () => {
    expect(at(chord(["LB", "A"]), 220)).toEqual({
      gesture: { kind: "chord", btns: ["A", "LB"] },
      t: 220,
    });
  });
});

// ===========================================================================
// Constructor outputs are frozen (defence against accidental mutation)
// ===========================================================================

describe("immutability", () => {
  it("tap output is frozen", () => {
    expect(Object.isFrozen(tap("A"))).toBe(true);
  });

  it("chord output is frozen", () => {
    const c = chord(["A", "LB"]);
    expect(Object.isFrozen(c)).toBe(true);
  });
});
