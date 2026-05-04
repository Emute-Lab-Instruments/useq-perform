// src/lib/menu/state.property.test.ts
//
// Property-based tests for the radial-menu reducer (`reduce`).
//
// These tests complement the golden transition cases in `state.test.ts`. The
// golden tests pin specific (state, input) pairs; the property tests check
// invariants that must hold across *all* valid (state, input) pairs — purity,
// frozen-stick latching, modular tab cycling, never-throws on arbitrary
// sequences, and so on. Mirrors the gamepad pipeline's property-test pattern
// per docs/specs/radial-menu.md §1.6.
//
// All generators build states by *walking forward* from `INITIAL_STATE` via
// random `MenuInput` traces — this avoids hand-crafting unreachable states
// (e.g. `MenuStateOpen` with bogus `manifest`) and keeps the reducer's
// reachability assumptions in scope.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { INITIAL_STATE, reduce, subPhase } from "./state";
import type {
  ApplyTarget,
  CategoryId,
  ItemId,
  Manifest,
  MenuInput,
  MenuState,
  MenuStateOpen,
  TabId,
  Verb,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture — minimal manifest. The reducer only cares about `tabs.length` and
// (for tab cycling and snapshot capture) the per-tab category/item counts;
// don't randomise the manifest, just use a stable fixture.
// ---------------------------------------------------------------------------

const TARGET = {} as ApplyTarget;
const A_VERB: Verb = { kind: "insert", hand: "left" };

/** Two-tab, two-category, two-item-per-category manifest. Right-tabs on tab 0
 *  give the right-cycle property something to wrap around (`% 3`). */
function makeManifest(): Manifest {
  return {
    version: 1,
    tabs: [
      {
        id: "tab-a" as TabId,
        label: "A",
        categories: [
          {
            id: "cat-a0" as CategoryId,
            label: "A0",
            items: [
              { kind: "symbol", id: "i-a0-0" as ItemId, label: "x", text: "x" },
              { kind: "symbol", id: "i-a0-1" as ItemId, label: "y", text: "y" },
            ],
          },
          {
            id: "cat-a1" as CategoryId,
            label: "A1",
            items: [
              { kind: "symbol", id: "i-a1-0" as ItemId, label: "p", text: "p" },
            ],
          },
        ],
        rightTabs: [
          { id: "rt-all" as never, label: "All", filter: (xs) => xs },
          { id: "rt-recent" as never, label: "Recent", filter: (xs) => xs },
          { id: "rt-fav" as never, label: "Fav", filter: (xs) => xs },
        ],
      },
      {
        id: "tab-b" as TabId,
        label: "B",
        categories: [
          {
            id: "cat-b0" as CategoryId,
            label: "B0",
            items: [
              { kind: "symbol", id: "i-b0-0" as ItemId, label: "q", text: "q" },
            ],
          },
        ],
      },
    ],
  };
}

const MANIFEST = makeManifest();
const TAB_COUNT = MANIFEST.tabs.length; // 2

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Stick hover: small ints in [0, 3] or `null`. The reducer treats indices
 *  opaquely (snapshotFromHovers checks bounds), so over-indexing is fine —
 *  it just declines to freeze. */
const arbHover = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 0, max: 3 }),
);

const arbSide = fc.constantFrom("left" as const, "right" as const);
const arbDir = fc.constantFrom(-1 as const, 1 as const);
const arbShoulderSide = fc.constantFrom(
  "left" as const,
  "right" as const,
  "both" as const,
);
const arbTransition = fc.constantFrom(
  "press" as const,
  "release" as const,
);
const arbFace = fc.constantFrom("A" as const, "X" as const, "Y" as const, "B" as const);
const arbMode = fc.constantFrom("numpad" as const, "t9" as const);
const arbReturnTo = fc.constantFrom("closed" as const, "open" as const);
const arbTs = fc.integer({ min: 0, max: 100_000 });

/** Generator over all 17 `MenuInput` variants. */
const arbInput: fc.Arbitrary<MenuInput> = fc.oneof(
  fc.record({
    kind: fc.constant("open" as const),
    target: fc.constant(TARGET),
    manifest: fc.constant(MANIFEST),
  }),
  fc.record({ kind: fc.constant("axisLeft" as const), hover: arbHover }),
  fc.record({ kind: fc.constant("axisRight" as const), hover: arbHover }),
  fc.record({
    kind: fc.constant("tabCycle" as const),
    side: arbSide,
    dir: arbDir,
  }),
  fc.record({
    kind: fc.constant("shoulderEdge" as const),
    side: arbShoulderSide,
    transition: arbTransition,
    ts: arbTs,
  }),
  fc.record({
    kind: fc.constant("face" as const),
    face: arbFace,
    ts: arbTs,
  }),
  fc.record({ kind: fc.constant("trigger" as const), side: arbSide }),
  fc.record({ kind: fc.constant("back" as const) }),
  fc.record({ kind: fc.constant("cancel" as const) }),
  fc.record({
    kind: fc.constant("subModeOpen" as const),
    mode: arbMode,
    target: fc.constant(TARGET),
    activeVerb: fc.constant(A_VERB),
    returnTo: arbReturnTo,
  }),
  fc.record({
    kind: fc.constant("subModeAppend" as const),
    char: fc.constantFrom("0", "1", "5", "a", "z", "."),
  }),
  fc.record({ kind: fc.constant("subModeBackspace" as const) }),
  fc.record({ kind: fc.constant("subModeCommitAndContinue" as const) }),
  fc.record({ kind: fc.constant("subModeCommitAndExit" as const) }),
  fc.record({
    kind: fc.constant("subModeT9Cycle" as const),
    key: fc.constantFrom("abc", "def", "ghi", "jkl"),
    ts: arbTs,
  }),
  fc.record({ kind: fc.constant("subModeT9IdleCommit" as const), ts: arbTs }),
);

/** A reachable `MenuState`: walk forward from INITIAL_STATE via a random
 *  prefix of inputs (≤20 long). Covers all four phases (closed / open /
 *  numpad / t9). */
const arbReachableState: fc.Arbitrary<MenuState> = fc
  .array(arbInput, { maxLength: 20 })
  .map((trace) => trace.reduce<MenuState>((s, i) => reduce(s, i), INITIAL_STATE));

/** A reachable open state — walk forward but reject samples that didn't land
 *  in 'open'. Bounded retries via `.filter(...)`. */
const arbOpenState: fc.Arbitrary<MenuStateOpen> = fc
  .array(arbInput, { maxLength: 20 })
  .map((trace) => trace.reduce<MenuState>((s, i) => reduce(s, i), INITIAL_STATE))
  .filter((s): s is MenuStateOpen => s.phase === "open");

/** A reachable open state in `frozen` sub-phase. We construct it directly via
 *  a known-good trace (open → axisLeft(0) → axisRight(0) → shoulderEdge(left,
 *  press)) since random walks rarely land here. Then layer extra inputs to
 *  diversify. */
const arbFrozenOpenState: fc.Arbitrary<MenuStateOpen> = fc
  .array(arbInput, { maxLength: 5 })
  .map((trace) => {
    let s: MenuState = INITIAL_STATE;
    s = reduce(s, { kind: "open", target: TARGET, manifest: MANIFEST });
    s = reduce(s, { kind: "axisLeft", hover: 0 });
    s = reduce(s, { kind: "axisRight", hover: 0 });
    s = reduce(s, {
      kind: "shoulderEdge",
      side: "left",
      transition: "press",
      ts: 0,
    });
    // Inject some extra inputs *while remaining frozen* — only no-op-ish
    // ones (axis updates are ignored in frozen anyway).
    for (const i of trace) {
      const next = reduce(s, i);
      // Only keep transitions that don't unlatch frozen.
      if (
        next.phase === "open" &&
        next.frozen !== null &&
        next.shoulderHeld !== "none"
      ) {
        s = next;
      }
    }
    return s;
  })
  .filter(
    (s): s is MenuStateOpen =>
      s.phase === "open" && s.frozen !== null,
  );

/** A reachable numpad state. */
const arbNumpadState = fc
  .array(arbInput, { maxLength: 10 })
  .map((trace) => {
    let s: MenuState = INITIAL_STATE;
    s = reduce(s, { kind: "open", target: TARGET, manifest: MANIFEST });
    s = reduce(s, {
      kind: "subModeOpen",
      mode: "numpad",
      target: TARGET,
      activeVerb: A_VERB,
      returnTo: "closed",
    });
    for (const i of trace) {
      const next = reduce(s, i);
      // Stay in numpad — drop transitions that exit.
      if (next.phase === "numpad") s = next;
    }
    return s;
  })
  .filter((s) => s.phase === "numpad");

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("reduce — property tests", () => {
  // -------------------------------------------------------------------------
  // 1. Determinism — pure function over (state, input)
  // -------------------------------------------------------------------------

  it("is deterministic: same (state, input) → same result", () => {
    fc.assert(
      fc.property(arbReachableState, arbInput, (state, input) => {
        const a = reduce(state, input);
        const b = reduce(state, input);
        // Structural equality (the reducer either returns the same reference
        // for no-ops or a fresh object for transitions; both calls must
        // produce the same shape).
        expect(a).toEqual(b);
      }),
      { numRuns: 500 },
    );
  });

  // -------------------------------------------------------------------------
  // 2. Cancel always closes
  // -------------------------------------------------------------------------

  it("cancel from any reachable state → closed", () => {
    fc.assert(
      fc.property(arbReachableState, (state) => {
        const next = reduce(state, { kind: "cancel" });
        // Reducer leaves `closed` unchanged (returns same ref); from any
        // other phase, cancel closes the menu.
        expect(next.phase).toBe("closed");
      }),
      { numRuns: 500 },
    );
  });

  // -------------------------------------------------------------------------
  // 3. Frozen stick latch — handedness-immutable while frozen
  // -------------------------------------------------------------------------

  it("axisLeft / axisRight do not mutate hovers while frozen", () => {
    fc.assert(
      fc.property(arbFrozenOpenState, arbHover, arbHover, (state, h1, h2) => {
        const after1 = reduce(state, { kind: "axisLeft", hover: h1 });
        const after2 = reduce(state, { kind: "axisRight", hover: h2 });
        // Reducer returns the same reference on frozen-suppressed input.
        expect(after1).toBe(state);
        expect(after2).toBe(state);
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // 4. Tab cycling is modular
  // -------------------------------------------------------------------------

  it("tabCycle(left, +1) advances leftTabIdx by 1 mod tab count (in cyclingLeftTabs)", () => {
    // Construct a known cyclingLeftTabs state (fresh open).
    const open = reduce(INITIAL_STATE, {
      kind: "open",
      target: TARGET,
      manifest: MANIFEST,
    });
    expect(open.phase).toBe("open");
    if (open.phase !== "open") return;

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        let s: MenuState = open;
        for (let i = 0; i < n; i++) {
          s = reduce(s, { kind: "tabCycle", side: "left", dir: 1 });
        }
        expect(s.phase).toBe("open");
        if (s.phase !== "open") return;
        expect(s.leftTabIdx).toBe(n % TAB_COUNT);
      }),
      { numRuns: 100 },
    );
  });

  it("tabCycle(left, -1) cycles backwards mod tab count", () => {
    const open = reduce(INITIAL_STATE, {
      kind: "open",
      target: TARGET,
      manifest: MANIFEST,
    });
    if (open.phase !== "open") return;

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        let s: MenuState = open;
        for (let i = 0; i < n; i++) {
          s = reduce(s, { kind: "tabCycle", side: "left", dir: -1 });
        }
        if (s.phase !== "open") return;
        expect(s.leftTabIdx).toBe(((-n % TAB_COUNT) + TAB_COUNT) % TAB_COUNT);
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 5. No throws on arbitrary input traces from INITIAL_STATE
  // -------------------------------------------------------------------------

  it("never throws on any input sequence (≤50 long) from INITIAL_STATE", () => {
    fc.assert(
      fc.property(fc.array(arbInput, { maxLength: 50 }), (trace) => {
        let s: MenuState = INITIAL_STATE;
        // Wrap each step — any throw fails the property.
        for (const i of trace) {
          s = reduce(s, i);
          // Reducer must always return a discriminated state.
          expect(["closed", "open", "numpad", "t9"]).toContain(s.phase);
        }
      }),
      { numRuns: 1000 },
    );
  });

  // -------------------------------------------------------------------------
  // 6. After 'open' from closed, result is open
  // -------------------------------------------------------------------------

  it("open input from closed state always yields phase='open'", () => {
    fc.assert(
      fc.property(fc.constant(INITIAL_STATE), (closed) => {
        const next = reduce(closed, {
          kind: "open",
          target: TARGET,
          manifest: MANIFEST,
        });
        expect(next.phase).toBe("open");
        if (next.phase !== "open") return;
        // Fresh open invariants per §3.1.2.
        expect(next.leftTabIdx).toBe(0);
        expect(next.rightTabIdx).toBe(0);
        expect(next.leftHover).toBeNull();
        expect(next.rightHover).toBeNull();
        expect(next.shoulderHeld).toBe("none");
        expect(next.frozen).toBeNull();
      }),
      { numRuns: 50 },
    );
  });

  // -------------------------------------------------------------------------
  // 7. subModeOpen entry produces matching sub-mode phase
  // -------------------------------------------------------------------------

  it("subModeOpen from open yields the requested sub-mode phase", () => {
    fc.assert(
      fc.property(arbOpenState, arbMode, arbReturnTo, (open, mode, returnTo) => {
        const next = reduce(open, {
          kind: "subModeOpen",
          mode,
          target: TARGET,
          activeVerb: A_VERB,
          returnTo,
        });
        expect(next.phase).toBe(mode);
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // 8. subModeCommitAndExit from numpad always closes
  //    (returnTo='open' is a sentinel that still routes through 'closed' per
  //    state.ts's reopenSentinel — D2 has a golden test for one path; here we
  //    assert the property over all reachable numpad states.)
  // -------------------------------------------------------------------------

  it("subModeCommitAndExit from any numpad state → closed", () => {
    fc.assert(
      fc.property(arbNumpadState, (np) => {
        const next = reduce(np, { kind: "subModeCommitAndExit" });
        expect(next.phase).toBe("closed");
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // 9. cancel is idempotent: applying twice == applying once
  // -------------------------------------------------------------------------

  it("cancel is idempotent (applying twice yields equivalent state)", () => {
    fc.assert(
      fc.property(arbReachableState, (state) => {
        const once = reduce(state, { kind: "cancel" });
        const twice = reduce(once, { kind: "cancel" });
        expect(twice).toEqual(once);
        // After the first cancel we're in `closed`; the reducer's closed
        // case returns the same reference for cancel.
        expect(twice).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  // -------------------------------------------------------------------------
  // 10. subPhase is total over all reachable open states
  // -------------------------------------------------------------------------

  it("subPhase returns one of the four documented values for any reachable open state", () => {
    fc.assert(
      fc.property(arbOpenState, (open) => {
        const sp = subPhase(open);
        expect(["cyclingLeftTabs", "cyclingRightTabs", "picking", "frozen"]).toContain(
          sp,
        );
      }),
      { numRuns: 300 },
    );
  });
});
