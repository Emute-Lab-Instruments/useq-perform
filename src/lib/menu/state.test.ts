// src/lib/menu/state.test.ts
//
// Golden transition tests for the radial-menu reducer (`reduce`) and the
// derived `subPhase` helper. Each `it` exercises one transition and asserts
// the resulting state with `expect(reduce(state, input)).toEqual(expected)`.
//
// These tests pin down the *implemented* behaviour (the regression net),
// honouring the spec-interpretation choices that state.ts documents inline.
// Where the spec is silent or under-defined (one-of-two shoulder release in
// frozen, sub-mode `returnTo: 'open'` re-entry without a manifest, etc.) the
// tests assert what state.ts chose, not what an idealised reading would say.
//
// References: docs/specs/radial-menu.md §2.4, §3.3, §4.x, §5, §6.x, §14.x.

import { describe, expect, it } from "vitest";

import { INITIAL_STATE, reduce, subPhase } from "./state";
import type {
  ApplyTarget,
  CategoryId,
  FrozenSnapshot,
  ItemId,
  Manifest,
  MenuInput,
  MenuStateNumpad,
  MenuStateOpen,
  MenuStateT9,
  TabId,
  Verb,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture helpers — hand-built minimal manifests, no JSON import.
// ---------------------------------------------------------------------------

/** Cast an opaque ApplyTarget. The reducer never reads its shape. */
const TARGET = {} as ApplyTarget;
const TARGET_2 = {} as ApplyTarget;

const A_VERB: Verb = { kind: "insert", hand: "left" };

function makeManifest(): Manifest {
  return {
    version: 1,
    tabs: [
      {
        id: "functions" as TabId,
        label: "Functions",
        categories: [
          {
            id: "math" as CategoryId,
            label: "Math",
            items: [
              { kind: "symbol", id: "sym-x" as ItemId, label: "x", text: "x" },
              { kind: "symbol", id: "sym-y" as ItemId, label: "y", text: "y" },
            ],
          },
          {
            id: "logic" as CategoryId,
            label: "Logic",
            items: [
              {
                kind: "literal",
                id: "lit-true" as ItemId,
                label: "true",
                literal: true,
                literalKind: "boolean",
              },
            ],
          },
        ],
        rightTabs: [
          {
            id: "all" as never,
            label: "All",
            filter: (items) => items,
          },
          {
            id: "recent" as never,
            label: "Recent",
            filter: (items) => items,
          },
        ],
      },
      {
        id: "literals" as TabId,
        label: "Literals",
        categories: [
          {
            id: "numbers" as CategoryId,
            label: "Numbers",
            items: [
              {
                kind: "literal",
                id: "lit-zero" as ItemId,
                label: "0",
                literal: 0,
                literalKind: "number",
              },
            ],
          },
        ],
      },
    ],
  };
}

/** A fresh open state (sub-phase: cyclingLeftTabs). */
function makeOpen(overrides: Partial<MenuStateOpen> = {}): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: null,
    rightHover: null,
    shoulderHeld: "none",
    frozen: null,
    target: TARGET,
    manifest: makeManifest(),
    ...overrides,
  };
}

function makeNumpad(overrides: Partial<MenuStateNumpad> = {}): MenuStateNumpad {
  return {
    phase: "numpad",
    buffer: "",
    target: TARGET,
    returnTo: "closed",
    activeVerb: A_VERB,
    ...overrides,
  };
}

function makeT9(overrides: Partial<MenuStateT9> = {}): MenuStateT9 {
  return {
    phase: "t9",
    buffer: "",
    lastKey: null,
    lastKeyAt: 0,
    caseMode: "lower",
    target: TARGET,
    returnTo: "closed",
    activeVerb: A_VERB,
    ...overrides,
  };
}

/** A frozen snapshot consistent with `(leftHover=0, rightHover=0)` in the
 *  fixture manifest's first tab + first category. */
function makeSnapshot(): FrozenSnapshot {
  return {
    leftTabIdx: 0,
    leftPicked: "math" as CategoryId,
    rightTabIdx: 0,
    rightPicked: "sym-x" as ItemId,
  };
}

// ===========================================================================
// INITIAL_STATE / sub-phase derivation
// ===========================================================================

describe("INITIAL_STATE", () => {
  it("is the closed state", () => {
    expect(INITIAL_STATE).toEqual({ phase: "closed" });
  });
});

describe("subPhase derivation", () => {
  it("both hovers null → cyclingLeftTabs", () => {
    expect(subPhase(makeOpen())).toBe("cyclingLeftTabs");
  });

  it("leftHover set, rightHover null → cyclingRightTabs", () => {
    expect(subPhase(makeOpen({ leftHover: 0 }))).toBe("cyclingRightTabs");
  });

  it("both hovers set → picking", () => {
    expect(subPhase(makeOpen({ leftHover: 0, rightHover: 0 }))).toBe("picking");
  });

  it("frozen snapshot present → frozen (regardless of hovers)", () => {
    expect(
      subPhase(
        makeOpen({
          leftHover: 0,
          rightHover: 0,
          shoulderHeld: "left",
          frozen: makeSnapshot(),
        }),
      ),
    ).toBe("frozen");
  });
});

// ===========================================================================
// closed state
// ===========================================================================

describe("reduce: closed", () => {
  const closed = INITIAL_STATE;

  it("open(target, manifest) → fresh open in cyclingLeftTabs", () => {
    const manifest = makeManifest();
    const input: MenuInput = { kind: "open", target: TARGET, manifest };
    expect(reduce(closed, input)).toEqual({
      phase: "open",
      leftTabIdx: 0,
      rightTabIdx: 0,
      leftHover: null,
      rightHover: null,
      shoulderHeld: "none",
      frozen: null,
      target: TARGET,
      manifest,
    });
  });

  it("cancel → unchanged (still closed)", () => {
    expect(reduce(closed, { kind: "cancel" })).toBe(closed);
  });

  it("back → unchanged", () => {
    expect(reduce(closed, { kind: "back" })).toBe(closed);
  });

  it("axisLeft hover → unchanged", () => {
    expect(reduce(closed, { kind: "axisLeft", hover: 0 })).toBe(closed);
  });

  it("axisRight hover → unchanged", () => {
    expect(reduce(closed, { kind: "axisRight", hover: 0 })).toBe(closed);
  });

  it("tabCycle → unchanged", () => {
    expect(reduce(closed, { kind: "tabCycle", side: "left", dir: 1 })).toBe(
      closed,
    );
  });

  it("shoulderEdge → unchanged", () => {
    expect(
      reduce(closed, {
        kind: "shoulderEdge",
        side: "left",
        transition: "press",
        ts: 0,
      }),
    ).toBe(closed);
  });

  it("face → unchanged", () => {
    expect(reduce(closed, { kind: "face", face: "A", ts: 0 })).toBe(closed);
  });

  it("subModeAppend → unchanged", () => {
    expect(reduce(closed, { kind: "subModeAppend", char: "5" })).toBe(closed);
  });
});

// ===========================================================================
// open state — sub-phase progression
// ===========================================================================

describe("reduce: open — sub-phase progression", () => {
  it("axisLeft(0) from cyclingLeftTabs → cyclingRightTabs (left hover set)", () => {
    const open = makeOpen();
    const next = reduce(open, { kind: "axisLeft", hover: 0 });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.leftHover).toBe(0);
    expect(next.rightHover).toBeNull();
    expect(subPhase(next)).toBe("cyclingRightTabs");
  });

  it("axisRight(0) after axisLeft(0) → picking", () => {
    const after1 = reduce(makeOpen(), { kind: "axisLeft", hover: 0 });
    const after2 = reduce(after1, { kind: "axisRight", hover: 0 });
    expect(after2.phase).toBe("open");
    if (after2.phase !== "open") return;
    expect(subPhase(after2)).toBe("picking");
    expect(after2.leftHover).toBe(0);
    expect(after2.rightHover).toBe(0);
  });

  it("axisLeft(null) cascades right hover to null (back to cyclingLeftTabs)", () => {
    const picking = makeOpen({ leftHover: 0, rightHover: 0 });
    const next = reduce(picking, { kind: "axisLeft", hover: null });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.leftHover).toBeNull();
    expect(next.rightHover).toBeNull();
    expect(subPhase(next)).toBe("cyclingLeftTabs");
  });

  it("axisLeft(0) when leftHover already 0 → reference-equal (no-op)", () => {
    const open = makeOpen({ leftHover: 0 });
    expect(reduce(open, { kind: "axisLeft", hover: 0 })).toBe(open);
  });

  it("axisRight(0) when rightHover already 0 → reference-equal (no-op)", () => {
    const open = makeOpen({ leftHover: 0, rightHover: 0 });
    expect(reduce(open, { kind: "axisRight", hover: 0 })).toBe(open);
  });

  it("axisLeft when frozen is ignored (frozen snapshot wins)", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    expect(reduce(frozen, { kind: "axisLeft", hover: 1 })).toBe(frozen);
  });

  it("axisRight when frozen is ignored", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    expect(reduce(frozen, { kind: "axisRight", hover: 1 })).toBe(frozen);
  });
});

// ===========================================================================
// open state — tab cycling (sub-phase-gated)
// ===========================================================================

describe("reduce: open — tab cycling", () => {
  it("tabCycle(left, +1) in cyclingLeftTabs → leftTabIdx wraps mod tab count", () => {
    const open = makeOpen(); // 2 tabs in fixture
    const next = reduce(open, { kind: "tabCycle", side: "left", dir: 1 });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.leftTabIdx).toBe(1);
    expect(next.rightTabIdx).toBe(0);
  });

  it("tabCycle(left, -1) in cyclingLeftTabs wraps to last tab", () => {
    const open = makeOpen({ leftTabIdx: 0 });
    const next = reduce(open, { kind: "tabCycle", side: "left", dir: -1 });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.leftTabIdx).toBe(1); // 2 tabs → -1 mod 2 = 1
  });

  it("tabCycle(left) in cyclingLeftTabs resets rightTabIdx to 0", () => {
    const open = makeOpen({ rightTabIdx: 1 });
    const next = reduce(open, { kind: "tabCycle", side: "left", dir: 1 });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.rightTabIdx).toBe(0);
  });

  it("tabCycle(left) in cyclingRightTabs → no-op (gated)", () => {
    const open = makeOpen({ leftHover: 0 });
    expect(reduce(open, { kind: "tabCycle", side: "left", dir: 1 })).toBe(open);
  });

  it("tabCycle(left) in picking → no-op (gated)", () => {
    const open = makeOpen({ leftHover: 0, rightHover: 0 });
    expect(reduce(open, { kind: "tabCycle", side: "left", dir: 1 })).toBe(open);
  });

  it("tabCycle(right) in cyclingRightTabs → rightTabIdx cycles, rightHover stays null", () => {
    const open = makeOpen({ leftHover: 0 }); // 2 right tabs on tab 0
    const next = reduce(open, { kind: "tabCycle", side: "right", dir: 1 });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.rightTabIdx).toBe(1);
    expect(next.rightHover).toBeNull();
  });

  it("tabCycle(right) in cyclingLeftTabs → no-op (gated)", () => {
    const open = makeOpen();
    expect(reduce(open, { kind: "tabCycle", side: "right", dir: 1 })).toBe(open);
  });

  it("tabCycle(right) in picking → no-op (gated)", () => {
    const open = makeOpen({ leftHover: 0, rightHover: 0 });
    expect(reduce(open, { kind: "tabCycle", side: "right", dir: 1 })).toBe(open);
  });
});

// ===========================================================================
// open state — shoulder edges and freeze
// ===========================================================================

describe("reduce: open — shoulder edges (freeze trigger)", () => {
  it("shoulderEdge(left, press) in picking with valid hovers → frozen snapshot captured", () => {
    const picking = makeOpen({ leftHover: 0, rightHover: 0 });
    const next = reduce(picking, {
      kind: "shoulderEdge",
      side: "left",
      transition: "press",
      ts: 100,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("left");
    expect(next.frozen).toEqual(makeSnapshot());
    expect(subPhase(next)).toBe("frozen");
  });

  it("shoulderEdge(right, press) in picking → frozen with shoulderHeld='right'", () => {
    const picking = makeOpen({ leftHover: 0, rightHover: 0 });
    const next = reduce(picking, {
      kind: "shoulderEdge",
      side: "right",
      transition: "press",
      ts: 100,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("right");
    expect(next.frozen).toEqual(makeSnapshot());
  });

  it("shoulderEdge(press) in cyclingLeftTabs → records held but does NOT freeze", () => {
    const open = makeOpen();
    const next = reduce(open, {
      kind: "shoulderEdge",
      side: "left",
      transition: "press",
      ts: 100,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("left");
    expect(next.frozen).toBeNull();
  });

  it("shoulderEdge(press) in cyclingRightTabs → records held but does NOT freeze", () => {
    const open = makeOpen({ leftHover: 0 });
    const next = reduce(open, {
      kind: "shoulderEdge",
      side: "left",
      transition: "press",
      ts: 100,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("left");
    expect(next.frozen).toBeNull();
  });

  it("shoulderEdge(right, press) while shoulderHeld='left' in frozen → 'both', frozen kept", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    const next = reduce(frozen, {
      kind: "shoulderEdge",
      side: "right",
      transition: "press",
      ts: 200,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("both");
    expect(next.frozen).toEqual(makeSnapshot());
  });

  it("shoulderEdge(left, release) when held=left in frozen → none, frozen cleared, picking resumes", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    const next = reduce(frozen, {
      kind: "shoulderEdge",
      side: "left",
      transition: "release",
      ts: 300,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("none");
    expect(next.frozen).toBeNull();
    expect(subPhase(next)).toBe("picking"); // hovers preserved
  });

  it("one-of-two release in frozen (held='both', release left) → 'right', frozen kept", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "both",
      frozen: makeSnapshot(),
    });
    const next = reduce(frozen, {
      kind: "shoulderEdge",
      side: "left",
      transition: "release",
      ts: 400,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("right");
    expect(next.frozen).toEqual(makeSnapshot()); // still frozen
  });

  it("shoulderEdge(both, press) → shoulderHeld='both' (coalesced edge)", () => {
    const picking = makeOpen({ leftHover: 0, rightHover: 0 });
    const next = reduce(picking, {
      kind: "shoulderEdge",
      side: "both",
      transition: "press",
      ts: 100,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("both");
    expect(next.frozen).toEqual(makeSnapshot());
  });

  it("shoulderEdge(both, release) when frozen → none + frozen cleared", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "both",
      frozen: makeSnapshot(),
    });
    const next = reduce(frozen, {
      kind: "shoulderEdge",
      side: "both",
      transition: "release",
      ts: 500,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.shoulderHeld).toBe("none");
    expect(next.frozen).toBeNull();
  });
});

// ===========================================================================
// open state — face (verb commit) and close paths
// ===========================================================================

describe("reduce: open — face buttons", () => {
  it("face(A) in frozen → closed (verb dispatch is dispatcher's job)", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    expect(reduce(frozen, { kind: "face", face: "A", ts: 100 })).toEqual({
      phase: "closed",
    });
  });

  it("face(X) in frozen → closed", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "right",
      frozen: makeSnapshot(),
    });
    expect(reduce(frozen, { kind: "face", face: "X", ts: 100 })).toEqual({
      phase: "closed",
    });
  });

  it("face(Y) in frozen → closed", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    expect(reduce(frozen, { kind: "face", face: "Y", ts: 100 })).toEqual({
      phase: "closed",
    });
  });

  it("face(B) in frozen → closed", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "right",
      frozen: makeSnapshot(),
    });
    expect(reduce(frozen, { kind: "face", face: "B", ts: 100 })).toEqual({
      phase: "closed",
    });
  });

  it("face in non-frozen open → no-op (returns same reference)", () => {
    const picking = makeOpen({ leftHover: 0, rightHover: 0 });
    expect(reduce(picking, { kind: "face", face: "A", ts: 100 })).toBe(picking);
  });

  it("face in cyclingLeftTabs → no-op", () => {
    const open = makeOpen();
    expect(reduce(open, { kind: "face", face: "A", ts: 100 })).toBe(open);
  });
});

describe("reduce: open — close paths", () => {
  it("cancel from any open sub-phase → closed", () => {
    const open = makeOpen({ leftHover: 0, rightHover: 0 });
    expect(reduce(open, { kind: "cancel" })).toEqual({ phase: "closed" });
  });

  it("back from non-frozen open → closed", () => {
    const picking = makeOpen({ leftHover: 0, rightHover: 0 });
    expect(reduce(picking, { kind: "back" })).toEqual({ phase: "closed" });
  });

  it("back from frozen → clears frozen + shoulderHeld, stays open", () => {
    const frozen = makeOpen({
      leftHover: 0,
      rightHover: 0,
      shoulderHeld: "left",
      frozen: makeSnapshot(),
    });
    const next = reduce(frozen, { kind: "back" });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.frozen).toBeNull();
    expect(next.shoulderHeld).toBe("none");
    expect(subPhase(next)).toBe("picking"); // hovers retained
  });

  it("re-open while open → fresh open with new target/manifest", () => {
    const open = makeOpen({ leftHover: 0, rightHover: 0 });
    const newManifest = makeManifest();
    const next = reduce(open, {
      kind: "open",
      target: TARGET_2,
      manifest: newManifest,
    });
    expect(next).toEqual({
      phase: "open",
      leftTabIdx: 0,
      rightTabIdx: 0,
      leftHover: null,
      rightHover: null,
      shoulderHeld: "none",
      frozen: null,
      target: TARGET_2,
      manifest: newManifest,
    });
  });
});

// ===========================================================================
// open state — sub-mode entry
// ===========================================================================

describe("reduce: open — subModeOpen entry", () => {
  it("subModeOpen(numpad) → MenuStateNumpad with carried target/verb/returnTo", () => {
    const open = makeOpen({ leftHover: 0, rightHover: 0 });
    const next = reduce(open, {
      kind: "subModeOpen",
      mode: "numpad",
      target: TARGET_2,
      activeVerb: A_VERB,
      returnTo: "open",
    });
    expect(next).toEqual({
      phase: "numpad",
      buffer: "",
      target: TARGET_2,
      returnTo: "open",
      activeVerb: A_VERB,
    });
  });

  it("subModeOpen(t9) → MenuStateT9 with fresh multi-tap state", () => {
    const open = makeOpen();
    const next = reduce(open, {
      kind: "subModeOpen",
      mode: "t9",
      target: TARGET_2,
      activeVerb: A_VERB,
      returnTo: "closed",
    });
    expect(next).toEqual({
      phase: "t9",
      buffer: "",
      lastKey: null,
      lastKeyAt: 0,
      caseMode: "lower",
      target: TARGET_2,
      returnTo: "closed",
      activeVerb: A_VERB,
    });
  });
});

describe("reduce: open — trigger and stray sub-mode inputs", () => {
  it("trigger → no-op (pagination deferred)", () => {
    const open = makeOpen();
    expect(reduce(open, { kind: "trigger", side: "left" })).toBe(open);
  });

  it("subModeAppend in open → no-op", () => {
    const open = makeOpen();
    expect(reduce(open, { kind: "subModeAppend", char: "5" })).toBe(open);
  });

  it("subModeBackspace in open → no-op", () => {
    const open = makeOpen();
    expect(reduce(open, { kind: "subModeBackspace" })).toBe(open);
  });

  it("subModeT9Cycle in open → no-op", () => {
    const open = makeOpen();
    expect(reduce(open, { kind: "subModeT9Cycle", key: "abc", ts: 0 })).toBe(
      open,
    );
  });
});

// ===========================================================================
// numpad sub-mode
// ===========================================================================

describe("reduce: numpad", () => {
  it("subModeAppend('5') → buffer becomes '5'", () => {
    const np = makeNumpad();
    expect(reduce(np, { kind: "subModeAppend", char: "5" })).toEqual({
      ...np,
      buffer: "5",
    });
  });

  it("subModeAppend appends sequentially", () => {
    const np = makeNumpad({ buffer: "12" });
    expect(reduce(np, { kind: "subModeAppend", char: "3" })).toEqual({
      ...np,
      buffer: "123",
    });
  });

  it("subModeBackspace drops last char", () => {
    const np = makeNumpad({ buffer: "123" });
    expect(reduce(np, { kind: "subModeBackspace" })).toEqual({
      ...np,
      buffer: "12",
    });
  });

  it("subModeBackspace on empty buffer → no-op (same reference)", () => {
    const np = makeNumpad({ buffer: "" });
    expect(reduce(np, { kind: "subModeBackspace" })).toBe(np);
  });

  it("subModeCommitAndContinue clears buffer (when non-empty)", () => {
    const np = makeNumpad({ buffer: "42" });
    expect(reduce(np, { kind: "subModeCommitAndContinue" })).toEqual({
      ...np,
      buffer: "",
    });
  });

  it("subModeCommitAndContinue on empty buffer → no-op", () => {
    const np = makeNumpad({ buffer: "" });
    expect(reduce(np, { kind: "subModeCommitAndContinue" })).toBe(np);
  });

  it("subModeCommitAndExit with returnTo='closed' → closed", () => {
    const np = makeNumpad({ buffer: "42", returnTo: "closed" });
    expect(reduce(np, { kind: "subModeCommitAndExit" })).toEqual({
      phase: "closed",
    });
  });

  it("subModeCommitAndExit with returnTo='open' → closed (sentinel; dispatcher re-issues open)", () => {
    const np = makeNumpad({ buffer: "42", returnTo: "open" });
    expect(reduce(np, { kind: "subModeCommitAndExit" })).toEqual({
      phase: "closed",
    });
  });

  it("back with returnTo='closed' → closed", () => {
    const np = makeNumpad({ buffer: "42" });
    expect(reduce(np, { kind: "back" })).toEqual({ phase: "closed" });
  });

  it("cancel → closed", () => {
    const np = makeNumpad({ buffer: "42" });
    expect(reduce(np, { kind: "cancel" })).toEqual({ phase: "closed" });
  });

  it("open(target, manifest) → fresh open replaces sub-mode", () => {
    const np = makeNumpad({ buffer: "42" });
    const newManifest = makeManifest();
    expect(
      reduce(np, { kind: "open", target: TARGET_2, manifest: newManifest }),
    ).toEqual({
      phase: "open",
      leftTabIdx: 0,
      rightTabIdx: 0,
      leftHover: null,
      rightHover: null,
      shoulderHeld: "none",
      frozen: null,
      target: TARGET_2,
      manifest: newManifest,
    });
  });

  it("subModeOpen(numpad) mid-buffer → buffer cleared, fields refreshed", () => {
    const np = makeNumpad({ buffer: "99", returnTo: "closed" });
    const next = reduce(np, {
      kind: "subModeOpen",
      mode: "numpad",
      target: TARGET_2,
      activeVerb: A_VERB,
      returnTo: "open",
    });
    expect(next).toEqual({
      phase: "numpad",
      buffer: "",
      target: TARGET_2,
      returnTo: "open",
      activeVerb: A_VERB,
    });
  });

  it("subModeOpen(t9) from numpad → switches to t9 wholesale", () => {
    const np = makeNumpad({ buffer: "99" });
    const next = reduce(np, {
      kind: "subModeOpen",
      mode: "t9",
      target: TARGET_2,
      activeVerb: A_VERB,
      returnTo: "closed",
    });
    expect(next).toEqual({
      phase: "t9",
      buffer: "",
      lastKey: null,
      lastKeyAt: 0,
      caseMode: "lower",
      target: TARGET_2,
      returnTo: "closed",
      activeVerb: A_VERB,
    });
  });

  it("face → no-op in numpad (face mapping is dispatcher-side)", () => {
    const np = makeNumpad({ buffer: "1" });
    expect(reduce(np, { kind: "face", face: "A", ts: 0 })).toBe(np);
  });

  it("axisLeft / axisRight / tabCycle / shoulderEdge / trigger → no-op", () => {
    const np = makeNumpad({ buffer: "1" });
    expect(reduce(np, { kind: "axisLeft", hover: 0 })).toBe(np);
    expect(reduce(np, { kind: "axisRight", hover: 0 })).toBe(np);
    expect(reduce(np, { kind: "tabCycle", side: "left", dir: 1 })).toBe(np);
    expect(
      reduce(np, {
        kind: "shoulderEdge",
        side: "left",
        transition: "press",
        ts: 0,
      }),
    ).toBe(np);
    expect(reduce(np, { kind: "trigger", side: "left" })).toBe(np);
  });

  it("subModeT9Cycle / subModeT9IdleCommit → no-op (T9-only inputs)", () => {
    const np = makeNumpad({ buffer: "1" });
    expect(reduce(np, { kind: "subModeT9Cycle", key: "abc", ts: 0 })).toBe(np);
    expect(reduce(np, { kind: "subModeT9IdleCommit", ts: 0 })).toBe(np);
  });
});

// ===========================================================================
// T9 sub-mode
// ===========================================================================

describe("reduce: t9", () => {
  it("subModeAppend appends to buffer (dispatcher writes the actual char)", () => {
    const t9 = makeT9();
    expect(reduce(t9, { kind: "subModeAppend", char: "a" })).toEqual({
      ...t9,
      buffer: "a",
    });
  });

  it("subModeBackspace drops last char and clears lastKey", () => {
    const t9 = makeT9({ buffer: "abc", lastKey: "abc", lastKeyAt: 100 });
    expect(reduce(t9, { kind: "subModeBackspace" })).toEqual({
      ...t9,
      buffer: "ab",
      lastKey: null,
    });
  });

  it("subModeBackspace on empty buffer → no-op", () => {
    const t9 = makeT9();
    expect(reduce(t9, { kind: "subModeBackspace" })).toBe(t9);
  });

  it("subModeT9Cycle records lastKey and lastKeyAt", () => {
    const t9 = makeT9();
    const next = reduce(t9, {
      kind: "subModeT9Cycle",
      key: "abc",
      ts: 500,
    });
    expect(next).toEqual({
      ...t9,
      lastKey: "abc",
      lastKeyAt: 500,
    });
  });

  it("subModeT9Cycle same-key updates lastKeyAt without altering buffer (bookkeeping)", () => {
    const t9 = makeT9({ buffer: "ab", lastKey: "abc", lastKeyAt: 100 });
    const next = reduce(t9, {
      kind: "subModeT9Cycle",
      key: "abc",
      ts: 250,
    });
    expect(next).toEqual({
      ...t9,
      buffer: "ab",
      lastKey: "abc",
      lastKeyAt: 250,
    });
  });

  it("subModeT9Cycle different key updates lastKey + lastKeyAt (buffer kept; dispatcher appends)", () => {
    const t9 = makeT9({ buffer: "a", lastKey: "abc", lastKeyAt: 100 });
    const next = reduce(t9, {
      kind: "subModeT9Cycle",
      key: "def",
      ts: 200,
    });
    expect(next).toEqual({
      ...t9,
      buffer: "a",
      lastKey: "def",
      lastKeyAt: 200,
    });
  });

  it("subModeT9IdleCommit clears lastKey, updates lastKeyAt", () => {
    const t9 = makeT9({ buffer: "ab", lastKey: "abc", lastKeyAt: 100 });
    expect(reduce(t9, { kind: "subModeT9IdleCommit", ts: 700 })).toEqual({
      ...t9,
      buffer: "ab",
      lastKey: null,
      lastKeyAt: 700,
    });
  });

  it("subModeCommitAndContinue clears buffer and lastKey (non-empty)", () => {
    const t9 = makeT9({ buffer: "abc", lastKey: "abc" });
    expect(reduce(t9, { kind: "subModeCommitAndContinue" })).toEqual({
      ...t9,
      buffer: "",
      lastKey: null,
    });
  });

  it("subModeCommitAndContinue on empty buffer → no-op", () => {
    const t9 = makeT9();
    expect(reduce(t9, { kind: "subModeCommitAndContinue" })).toBe(t9);
  });

  it("subModeCommitAndExit with returnTo='closed' → closed", () => {
    const t9 = makeT9({ buffer: "abc", returnTo: "closed" });
    expect(reduce(t9, { kind: "subModeCommitAndExit" })).toEqual({
      phase: "closed",
    });
  });

  it("subModeCommitAndExit with returnTo='open' → closed (sentinel)", () => {
    const t9 = makeT9({ buffer: "abc", returnTo: "open" });
    expect(reduce(t9, { kind: "subModeCommitAndExit" })).toEqual({
      phase: "closed",
    });
  });

  it("back with returnTo='closed' → closed", () => {
    const t9 = makeT9({ buffer: "abc" });
    expect(reduce(t9, { kind: "back" })).toEqual({ phase: "closed" });
  });

  it("cancel → closed", () => {
    const t9 = makeT9({ buffer: "abc" });
    expect(reduce(t9, { kind: "cancel" })).toEqual({ phase: "closed" });
  });

  it("open(target, manifest) → fresh open replaces sub-mode", () => {
    const t9 = makeT9({ buffer: "abc" });
    const newManifest = makeManifest();
    const next = reduce(t9, {
      kind: "open",
      target: TARGET_2,
      manifest: newManifest,
    });
    expect(next.phase).toBe("open");
    if (next.phase !== "open") return;
    expect(next.target).toBe(TARGET_2);
    expect(next.manifest).toBe(newManifest);
  });

  it("subModeOpen(t9) mid-buffer → buffer/lastKey cleared, fields refreshed", () => {
    const t9 = makeT9({ buffer: "abc", lastKey: "abc", lastKeyAt: 100 });
    const next = reduce(t9, {
      kind: "subModeOpen",
      mode: "t9",
      target: TARGET_2,
      activeVerb: A_VERB,
      returnTo: "open",
    });
    expect(next).toEqual({
      phase: "t9",
      buffer: "",
      lastKey: null,
      lastKeyAt: 0,
      caseMode: "lower",
      target: TARGET_2,
      returnTo: "open",
      activeVerb: A_VERB,
    });
  });

  it("subModeOpen(numpad) from t9 → switches to numpad wholesale", () => {
    const t9 = makeT9({ buffer: "abc" });
    const next = reduce(t9, {
      kind: "subModeOpen",
      mode: "numpad",
      target: TARGET_2,
      activeVerb: A_VERB,
      returnTo: "closed",
    });
    expect(next).toEqual({
      phase: "numpad",
      buffer: "",
      target: TARGET_2,
      returnTo: "closed",
      activeVerb: A_VERB,
    });
  });

  it("axisLeft / axisRight / tabCycle / shoulderEdge / face / trigger → no-op", () => {
    const t9 = makeT9({ buffer: "a" });
    expect(reduce(t9, { kind: "axisLeft", hover: 0 })).toBe(t9);
    expect(reduce(t9, { kind: "axisRight", hover: 0 })).toBe(t9);
    expect(reduce(t9, { kind: "tabCycle", side: "left", dir: 1 })).toBe(t9);
    expect(
      reduce(t9, {
        kind: "shoulderEdge",
        side: "left",
        transition: "press",
        ts: 0,
      }),
    ).toBe(t9);
    expect(reduce(t9, { kind: "face", face: "A", ts: 0 })).toBe(t9);
    expect(reduce(t9, { kind: "trigger", side: "right" })).toBe(t9);
  });
});
