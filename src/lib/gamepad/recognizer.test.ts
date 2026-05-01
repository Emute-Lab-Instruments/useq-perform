// src/lib/gamepad/recognizer.test.ts
//
// Golden tests for the Stage 2 recognizer. The recognizer is a pure
// function: `recognize(LogicalEvent[]) → RecognitionOutput`. It is
// binding-blind — it emits every structurally-recognized gesture; the
// dispatcher (Stage 3) decides what to actually fire.
//
// Each cycle of the TDD rebuild adds one primitive. This file grows
// over time. See docs/specs/gamepad.md §3.2 and §5.

import { describe, expect, it } from "vitest";

import { at, chord, flick, held, hold, tap } from "./gestures";
import {
  DEFAULT_TIMING,
  INITIAL_STATE,
  flush,
  recognize,
  step,
  type RecognizerState,
  type Timing,
} from "./recognizer";
import type { LogicalEvent } from "./types";

// Suppress held emissions for tests scoped to other primitives.
// `Number.MAX_SAFE_INTEGER` ensures the held-initial threshold is never
// reached within any realistic test timeline.
const NO_HELD: Partial<Timing> = {
  heldInitialMs: Number.MAX_SAFE_INTEGER,
};

// ===========================================================================
// Cycle 2 — tap
//
// Every `press` event emits a `tap` gesture at press time. Releases are
// recorded (for future cycles' use) but emit nothing themselves. Axis
// events are deferred to a later cycle.
// ===========================================================================

describe("recognize: tap (Cycle 2)", () => {
  it("a single press-release pair emits one tap at press time", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 100 },
    ];
    expect(recognize(events)).toEqual({
      gestures: [at(tap("A"), 0)],
      axes: [],
    });
  });

  it("tap timestamp tracks the press, not the release", () => {
    // Release stays well under T_hold (250 ms) so no hold fires here —
    // the assertion is purely about tap's chosen timestamp.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "X", t: 1234 },
      { kind: "release", btn: "X", t: 1300 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("X"), 1234)]);
  });

  it("each press emits its own tap, in input order", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 50 },
      { kind: "press",   btn: "B", t: 200 },
      { kind: "release", btn: "B", t: 250 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 200),
    ]);
  });

  it("a press with no release still emits a tap (ongoing press at end-of-stream)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("A"), 0)]);
  });

  it("a release with no prior press is silently ignored", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "release", btn: "A", t: 100 },
    ];
    expect(recognize(events)).toEqual({ gestures: [], axes: [] });
  });

  it("empty input → empty output", () => {
    expect(recognize([])).toEqual({ gestures: [], axes: [] });
  });

  it("preserves press order across distinct buttons", () => {
    // Timestamps spread well beyond chordGraceMs (default 30) so chord
    // detection doesn't fire — keeps this test scoped to tap ordering.
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0   },
      { kind: "press", btn: "B", t: 100 },
      { kind: "press", btn: "X", t: 200 },
    ];
    expect(recognize(events).gestures.map(g => g.gesture)).toEqual([
      tap("A"), tap("B"), tap("X"),
    ]);
  });

  it("simultaneous-timestamp presses preserve input order (with their chord)", () => {
    // Simultaneous polls (same t) MUST be ordered deterministically by
    // position in the input stream. Same-t presses also form a chord —
    // its btns are canonical regardless of input order.
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "B", t: 100 },
      { kind: "press", btn: "A", t: 100 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("B"), 100),
      at(tap("A"), 100),
      at(chord(["A", "B"]), 100),
    ]);
  });

  // -- Determinism / purity ---------------------------------------------

  it("is deterministic: same input → same output", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "press",   btn: "B", t: 50 },
      { kind: "release", btn: "A", t: 100 },
      { kind: "release", btn: "B", t: 150 },
    ];
    const a = recognize(events);
    const b = recognize(events);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 100 },
    ];
    const snapshot = JSON.stringify(events);
    recognize(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  // -- Axis events pass through silently --------------------------------

  it("axis events do not produce taps (deferred to flick cycle)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0.5, y: 0, t: 50 },
      { kind: "press", btn: "A", t: 100 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("A"), 100)]);
  });
});

// ===========================================================================
// Cycle 3 — hold
//
// `hold` is a one-shot fired exactly at `pressTime + T_hold` if and only if
// the button is still pressed STRICTLY PAST that moment (release at exactly
// T_hold does not count). Hold is emitted IN ADDITION to tap — the
// recognizer is binding-blind; the dispatcher decides which to fire.
//
// Default T_hold is 250 ms, configurable via `timing.holdMs`.
// ===========================================================================

describe("recognize: hold (Cycle 3)", () => {
  it("press held past T_hold emits hold at pressTime + T_hold", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 300 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
    ]);
  });

  it("release before T_hold cancels the hold", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 200 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("A"), 0)]);
  });

  it("release at exactly T_hold does NOT emit hold (boundary)", () => {
    // Spec §3.2.2: "held continuously PAST T_hold" — strict.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 250 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("A"), 0)]);
  });

  it("release one ms past T_hold emits hold at scheduledAt", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "release", btn: "A", t: 251 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
    ]);
  });

  it("press without release emits hold when evaluateUpTo passes threshold", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
    ];
    expect(recognize(events, { evaluateUpTo: 300 }).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
    ]);
  });

  it("evaluateUpTo equal to threshold does NOT emit hold (boundary)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
    ];
    expect(recognize(events, { evaluateUpTo: 250 }).gestures).toEqual([
      at(tap("A"), 0),
    ]);
  });

  it("evaluateUpTo defaults to last-event time", () => {
    // Press without release with no explicit evaluateUpTo — last event is
    // the press at t=0, so default is 0; threshold not reached.
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("A"), 0)]);
  });

  it("two held buttons emit holds at independent thresholds", () => {
    // Releases stay within the held-initial boundary so this test stays
    // scoped to hold behaviour. A held at 300 boundary, B held at 350.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "press",   btn: "B", t: 50  },
      { kind: "release", btn: "A", t: 290 },
      { kind: "release", btn: "B", t: 340 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 50),
      at(hold("A"), 250),
      at(hold("B"), 300),
    ]);
  });

  it("releasing one button only cancels its own pending hold", () => {
    // B's release stays under its held-initial boundary (50 + 300 = 350).
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "press",   btn: "B", t: 50  },
      { kind: "release", btn: "A", t: 100 },  // A: well before threshold
      { kind: "release", btn: "B", t: 340 },  // B: past hold, before held
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 50),
      at(hold("B"), 300),
    ]);
  });

  it("press → release → press tracks each press independently", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 100 },  // first press: no hold
      { kind: "press",   btn: "A", t: 400 },
      { kind: "release", btn: "A", t: 700 },  // second press: hold
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("A"), 400),
      at(hold("A"), 650),
    ]);
  });

  it("holdMs is configurable via timing override", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 200 },
    ];
    expect(
      recognize(events, { timing: { holdMs: 100 } }).gestures,
    ).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 100),
    ]);
  });

  it("hold timestamp is scheduledAt, not the triggering event's t", () => {
    // Many tools naïvely tag the hold with whatever event surfaced it.
    // The spec requires the threshold time as the gesture's logical moment.
    // Release stays under held-initial (100 + 300 = 400) so the assertion
    // remains scoped to hold's timestamp choice.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 100 },
      { kind: "release", btn: "A", t: 380 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 100),
      at(hold("A"), 350), // 100 + 250, NOT 380
    ]);
  });

  it("catch-up emits multiple due holds in scheduledAt order", () => {
    // Both holds must fire from a single catch-up; releases need to be
    // past the later hold's scheduledAt. Default heldInitialMs would also
    // fire by then, so we suppress held to keep this test scoped to hold
    // ordering during catch-up.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0    },
      { kind: "press",   btn: "B", t: 100  },
      { kind: "release", btn: "A", t: 1000 },
      { kind: "release", btn: "B", t: 1100 },
    ];
    expect(recognize(events, { timing: NO_HELD }).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 100),
      at(hold("A"), 250),
      at(hold("B"), 350),
    ]);
  });

  it("is deterministic with hold timers", () => {
    // Releases stay under each button's held-initial boundary
    // (A: 300, B: 350) to keep the assertion scoped to hold determinism.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "press",   btn: "B", t: 50  },
      { kind: "release", btn: "A", t: 280 },
      { kind: "release", btn: "B", t: 340 },
    ];
    expect(recognize(events)).toEqual(recognize(events));
  });
});

// ===========================================================================
// Cycle 4 — held (auto-repeat)
//
// `held` ticks fire while a button stays pressed past `heldInitialMs`,
// then every `heldRepeatMs` thereafter. `n` counts from 1 at the first
// tick. Held emits in addition to tap and (for buttons held past
// holdMs) hold — the recognizer is binding-blind. Hold/held mutual
// exclusion is enforced at bindings load, not here.
//
// Defaults: heldInitialMs=300, heldRepeatMs=60.
// ===========================================================================

describe("recognize: held (Cycle 4)", () => {
  it("press held just past heldInitialMs emits one held tick at scheduledAt", () => {
    // Press at 0; held(n=1) scheduled at 300. Release at 350 > 300, so
    // the first tick fires; next tick (360) is after the release.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 350 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
      at(held("A", 1), 300),
    ]);
  });

  it("release at exactly heldInitialMs does NOT emit held (boundary)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 300 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
    ]);
  });

  it("emits successive held ticks at heldRepeatMs intervals", () => {
    // Press at 0; held ticks at 300, 360, 420. Release at 421 catches
    // the n=3 tick at 420 but not the next at 480.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 421 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
      at(held("A", 1), 300),
      at(held("A", 2), 360),
      at(held("A", 3), 420),
    ]);
  });

  it("release at exactly the next-tick scheduledAt does NOT emit that tick (boundary)", () => {
    // Press at 0; held ticks at 300, 360, 420. Release at 420 hits the
    // boundary — tick n=3 not fired.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 420 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
      at(held("A", 1), 300),
      at(held("A", 2), 360),
    ]);
  });

  it("press without release emits held ticks up to evaluateUpTo", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
    ];
    expect(recognize(events, { evaluateUpTo: 400 }).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
      at(held("A", 1), 300),
      at(held("A", 2), 360),
    ]);
  });

  it("evaluateUpTo at exactly heldInitialMs does NOT emit (boundary)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
    ];
    expect(recognize(events, { evaluateUpTo: 300 }).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
    ]);
  });

  it("custom held timing flows through", () => {
    // heldInitialMs=100, heldRepeatMs=20. Press at 0, release at 180.
    // Ticks at 100, 120, 140, 160. Release-at-180 boundary excludes 180.
    // (Hold default of 250ms isn't reached.)
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 180 },
    ];
    expect(
      recognize(events, {
        timing: { heldInitialMs: 100, heldRepeatMs: 20 },
      }).gestures,
    ).toEqual([
      at(tap("A"), 0),
      at(held("A", 1), 100),
      at(held("A", 2), 120),
      at(held("A", 3), 140),
      at(held("A", 4), 160),
    ]);
  });

  it("release cancels held (no further ticks emitted)", () => {
    // Press at 0, release at 200 (well before heldInitialMs).
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 200 },
    ];
    expect(recognize(events).gestures).toEqual([at(tap("A"), 0)]);
  });

  it("two buttons emit held ticks on independent schedules", () => {
    // A pressed at 0 → held A schedule: 300, 360, 420.
    // B pressed at 50 → held B schedule: 350, 410, 470.
    // Release A at 425 catches A's n=1 (300), n=2 (360), n=3 (420).
    // Release B at 475 catches B's n=1 (350), n=2 (410), n=3 (470).
    // Holds also fire: hold A at 250, hold B at 300.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "press",   btn: "B", t: 50  },
      { kind: "release", btn: "A", t: 425 },
      { kind: "release", btn: "B", t: 475 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 50),
      at(hold("A"), 250),
      at(hold("B"), 300),
      at(held("A", 1), 300),
      at(held("B", 1), 350),
      at(held("A", 2), 360),
      at(held("B", 2), 410),
      at(held("A", 3), 420),
      at(held("B", 3), 470),
    ]);
  });

  it("press → release → press resets the held counter", () => {
    // First press: tap, hold, held(1) at 300, held(2) at 360. Release 380.
    // Second press at 500: tap, hold(750), held(1) at 800, held(2) at 860.
    // evaluateUpTo defaults to 870 (last event).
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 380 },
      { kind: "press",   btn: "A", t: 500 },
      { kind: "release", btn: "A", t: 870 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(hold("A"), 250),
      at(held("A", 1), 300),
      at(held("A", 2), 360),
      at(tap("A"), 500),
      at(hold("A"), 750),
      at(held("A", 1), 800),
      at(held("A", 2), 860),
    ]);
  });

  it("is deterministic with held timers", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "release", btn: "A", t: 500 },
    ];
    expect(recognize(events)).toEqual(recognize(events));
  });
});

// ===========================================================================
// Cycle 5 — chord
//
// Chord = ≥ 2 buttons pressed within `chordGraceMs` of each other (looking
// back from the latest press). On each press, if any currently-held
// button was pressed within the grace window, emit `chord(those + this)`
// at the new press's t. Multiple chord emissions per session are
// allowed (the chord set may grow as more buttons join).
//
// Default chordGraceMs is 30. Comparison is inclusive (`elapsed ≤ grace`).
// Chord btns are canonicalised by BUTTON_ORDER (handled by `chordFromArray`).
// ===========================================================================

describe("recognize: chord (Cycle 5)", () => {
  it("two same-t presses emit chord(A,B) at t", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 0  },
      { kind: "release", btn: "A", t: 50 },
      { kind: "release", btn: "B", t: 50 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 0),
      at(chord(["A", "B"]), 0),
    ]);
  });

  it("two presses within chordGraceMs emit chord at the later press's t", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 20 },
      { kind: "release", btn: "A", t: 60 },
      { kind: "release", btn: "B", t: 70 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 20),
      at(chord(["A", "B"]), 20),
    ]);
  });

  it("two presses at exactly the grace boundary emit chord (inclusive)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 30 },  // = chordGraceMs default
      { kind: "release", btn: "A", t: 60 },
      { kind: "release", btn: "B", t: 70 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 30),
      at(chord(["A", "B"]), 30),
    ]);
  });

  it("two presses just past the grace boundary do NOT emit chord", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 31 },
      { kind: "release", btn: "A", t: 60 },
      { kind: "release", btn: "B", t: 70 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 31),
    ]);
  });

  it("three same-t presses emit chord(A,B) then chord(A,B,C) (cumulative)", () => {
    // Each press emits a chord with all currently-held + this button.
    // Dispatcher resolves which chord-binding (if any) wins; eager-with-undo
    // rolls back redundant fires.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 0  },
      { kind: "press",   btn: "X", t: 0  },
      { kind: "release", btn: "A", t: 50 },
      { kind: "release", btn: "B", t: 50 },
      { kind: "release", btn: "X", t: 50 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 0),
      at(chord(["A", "B"]), 0),
      at(tap("X"), 0),
      at(chord(["A", "B", "X"]), 0),
    ]);
  });

  it("chord btns are canonicalised regardless of press order", () => {
    // LB pressed before A; chord should still report btns canonically (A < LB).
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "LB", t: 0  },
      { kind: "press",   btn: "A",  t: 10 },
      { kind: "release", btn: "LB", t: 50 },
      { kind: "release", btn: "A",  t: 60 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("LB"), 0),
      at(tap("A"), 10),
      at(chord(["A", "LB"]), 10),
    ]);
  });

  it("chord t is the latest press's t (not the earliest)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 100 },
      { kind: "press",   btn: "B", t: 110 },
      { kind: "release", btn: "A", t: 150 },
      { kind: "release", btn: "B", t: 160 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 100),
      at(tap("B"), 110),
      at(chord(["A", "B"]), 110),
    ]);
  });

  it("chordGraceMs is configurable via timing override", () => {
    // grace=10. Press at 0, press at 15. 15 > 10 → no chord.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 15 },
      { kind: "release", btn: "A", t: 60 },
      { kind: "release", btn: "B", t: 70 },
    ];
    expect(
      recognize(events, { timing: { chordGraceMs: 10 } }).gestures,
    ).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 15),
    ]);
  });

  it("a released button does not form a chord with a later press", () => {
    // A pressed and released, then B pressed within what would be grace
    // of A's press time. A is no longer held — no chord.
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "release", btn: "A", t: 5  },
      { kind: "press",   btn: "B", t: 10 },
      { kind: "release", btn: "B", t: 50 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 10),
    ]);
  });

  it("is deterministic with chord detection", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0  },
      { kind: "press",   btn: "B", t: 10 },
      { kind: "release", btn: "A", t: 50 },
      { kind: "release", btn: "B", t: 60 },
    ];
    expect(recognize(events)).toEqual(recognize(events));
  });
});

// ===========================================================================
// Cycle 6 — flick + AxisFrame
//
// Stick processing: each axis event reports the full 2D stick state
// `(x, y)` for one stick. The recognizer:
//   - Applies the deadzone to the magnitude: |⟨x,y⟩| < deadzone → (0,0).
//   - Emits an AxisFrame whenever the post-deadzone (x, y) for that
//     stick has changed from the last frame for the same stick.
//   - Emits a discrete `flick(stick, dir)` when the magnitude is
//     ≥ flickThreshold AND the stick is currently armed. Disarms after
//     emitting; re-arms when the stick returns to (0, 0).
//
// Direction: based on which component has the larger absolute value
// (horizontal vs vertical). Ties (|x| = |y|) prefer horizontal.
//
// Defaults: stickDeadzone=0.12, flickThreshold=0.7.
// ===========================================================================

describe("recognize: flick + axis (Cycle 6)", () => {
  it("strong upward stick deflection emits flick(LeftStick, up)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -1, t: 10 },
    ];
    const out = recognize(events);
    expect(out.gestures).toEqual([at(flick("LeftStick", "up"), 10)]);
    expect(out.axes).toEqual([
      { stick: "LeftStick", x: 0, y: -1, t: 10 },
    ]);
  });

  it("flick maps cardinal directions correctly", () => {
    const cases: Array<{ x: number; y: number; dir: "up" | "down" | "left" | "right" }> = [
      { x:  0, y: -1, dir: "up"    },
      { x:  0, y:  1, dir: "down"  },
      { x:  1, y:  0, dir: "right" },
      { x: -1, y:  0, dir: "left"  },
    ];
    for (const c of cases) {
      const out = recognize([
        { kind: "axis", stick: "LeftStick", x: c.x, y: c.y, t: 0 },
      ]);
      expect(out.gestures).toEqual([at(flick("LeftStick", c.dir), 0)]);
    }
  });

  it("threshold boundary (= flickThreshold) emits flick (inclusive ≥)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -0.7, t: 10 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(flick("LeftStick", "up"), 10),
    ]);
  });

  it("below-threshold magnitude does NOT emit flick", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -0.5, t: 10 },
    ];
    expect(recognize(events).gestures).toEqual([]);
    // Still emits an AxisFrame for the underlying value change.
    expect(recognize(events).axes).toEqual([
      { stick: "LeftStick", x: 0, y: -0.5, t: 10 },
    ]);
  });

  it("flick fires only once until the stick returns to deadzone (re-arm)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -1, t: 10 }, // flick
      { kind: "axis", stick: "LeftStick", x: 0, y: -0.9, t: 20 }, // still held; no new flick
      { kind: "axis", stick: "LeftStick", x: 0, y: -1, t: 30 },   // still held; no new flick
    ];
    expect(recognize(events).gestures).toEqual([
      at(flick("LeftStick", "up"), 10),
    ]);
  });

  it("returning to deadzone re-arms the flick", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -1, t: 10 },
      { kind: "axis", stick: "LeftStick", x: 0, y: 0,  t: 20 }, // re-arm
      { kind: "axis", stick: "LeftStick", x: 0, y: -1, t: 30 }, // flick again
    ];
    expect(recognize(events).gestures).toEqual([
      at(flick("LeftStick", "up"), 10),
      at(flick("LeftStick", "up"), 30),
    ]);
  });

  it("magnitude inside the deadzone is reported as (0, 0) — no AxisFrame, no flick", () => {
    // 0.05² + 0.05² = 0.005 → |⟨⟩| ≈ 0.07 < 0.12 deadzone.
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0.05, y: 0.05, t: 10 },
    ];
    const out = recognize(events);
    expect(out.gestures).toEqual([]);
    expect(out.axes).toEqual([]); // initial was (0,0); deadzoned still (0,0)
  });

  it("two events both inside the deadzone produce no AxisFrame", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0.05, y: 0,    t: 10 },
      { kind: "axis", stick: "LeftStick", x: 0.10, y: 0.05, t: 20 },
    ];
    expect(recognize(events).axes).toEqual([]);
  });

  it("each AxisFrame corresponds to a real (post-deadzone) change", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0,    y: -0.5, t: 10 },
      { kind: "axis", stick: "LeftStick", x: 0,    y: -0.5, t: 20 }, // no change → no frame
      { kind: "axis", stick: "LeftStick", x: 0.5,  y: -0.5, t: 30 }, // change
    ];
    expect(recognize(events).axes).toEqual([
      { stick: "LeftStick", x: 0,   y: -0.5, t: 10 },
      { stick: "LeftStick", x: 0.5, y: -0.5, t: 30 },
    ]);
  });

  it("returning to deadzone emits an AxisFrame at (0, 0)", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -1, t: 10 },
      { kind: "axis", stick: "LeftStick", x: 0, y: 0,  t: 20 },
    ];
    expect(recognize(events).axes).toEqual([
      { stick: "LeftStick", x: 0, y: -1, t: 10 },
      { stick: "LeftStick", x: 0, y: 0,  t: 20 },
    ]);
  });

  it("the two sticks are tracked independently", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick",  x: 0, y: -1, t: 10 },
      { kind: "axis", stick: "RightStick", x: 1, y: 0,  t: 20 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(flick("LeftStick", "up"),    10),
      at(flick("RightStick", "right"), 20),
    ]);
  });

  it("equal-magnitude diagonal (45°) prefers horizontal direction", () => {
    // (0.7, -0.7): |x|=|y|, magnitude ≈ 0.99 > threshold. Tiebreak: horizontal.
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0.7, y: -0.7, t: 10 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(flick("LeftStick", "right"), 10),
    ]);
  });

  it("flickThreshold is configurable", () => {
    // Lower threshold to 0.3; (0, -0.5) now crosses.
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -0.5, t: 10 },
    ];
    expect(
      recognize(events, { timing: { flickThreshold: 0.3 } }).gestures,
    ).toEqual([at(flick("LeftStick", "up"), 10)]);
  });

  it("stickDeadzone is configurable", () => {
    // Raise deadzone to 0.6; (0, -0.5) now reads as (0, 0).
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -0.5, t: 10 },
    ];
    const out = recognize(events, { timing: { stickDeadzone: 0.6 } });
    expect(out.axes).toEqual([]);
    expect(out.gestures).toEqual([]);
  });

  it("is deterministic with stick processing", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "axis", stick: "LeftStick", x: 0, y: -0.5, t: 10 },
      { kind: "axis", stick: "LeftStick", x: 0, y: -1,   t: 20 },
      { kind: "axis", stick: "LeftStick", x: 0, y: 0,    t: 30 },
    ];
    expect(recognize(events)).toEqual(recognize(events));
  });
});

// ===========================================================================
// step / flush — incremental API contract
//
// `step` and `flush` are the primitive API; `recognize` is a fold over them.
// Production calls them per-tick from the polling loop; these tests pin
// down the incremental contract independent of primitive-specific behaviour.
// ===========================================================================

describe("step / flush", () => {
  it("INITIAL_STATE has no pending state", () => {
    expect(INITIAL_STATE).toEqual({
      pendingHolds: [],
      pendingHelds: [],
      sticks: {
        LeftStick:  { armed: true, lastEmittedX: 0, lastEmittedY: 0 },
        RightStick: { armed: true, lastEmittedX: 0, lastEmittedY: 0 },
      },
    });
  });

  it("step on a press records a pending hold and emits a tap", () => {
    const out = step(
      INITIAL_STATE,
      { kind: "press", btn: "A", t: 0 },
      DEFAULT_TIMING,
    );
    expect(out.gestures).toEqual([at(tap("A"), 0)]);
    expect(out.state.pendingHolds).toEqual([{ btn: "A", scheduledAt: 250 }]);
  });

  it("step does not mutate its input state", () => {
    const before = INITIAL_STATE;
    const beforePendingRef = before.pendingHolds;
    step(before, { kind: "press", btn: "A", t: 0 }, DEFAULT_TIMING);
    expect(before).toBe(INITIAL_STATE);
    expect(before.pendingHolds).toBe(beforePendingRef);
    expect(before.pendingHolds).toEqual([]);
  });

  it("step on an in-deadzone axis event leaves stick state at zero", () => {
    // (0.05, 0) has magnitude < deadzone (0.12) — deadzoned to (0, 0).
    // No AxisFrame (no change from initial 0,0). No flick.
    const after = step(
      INITIAL_STATE,
      { kind: "axis", stick: "LeftStick", x: 0.05, y: 0, t: 0 },
      DEFAULT_TIMING,
    );
    expect(after.gestures).toEqual([]);
    expect(after.axes).toEqual([]);
    // Sticks state initialised; both sticks still at zero, both armed.
    expect(after.state.sticks.LeftStick).toEqual({
      armed: true,
      lastEmittedX: 0,
      lastEmittedY: 0,
    });
  });

  it("step on a release with no matching press is a no-op (state unchanged)", () => {
    const after = step(
      INITIAL_STATE,
      { kind: "release", btn: "A", t: 100 },
      DEFAULT_TIMING,
    );
    expect(after.state).toEqual(INITIAL_STATE);
    expect(after.gestures).toEqual([]);
  });

  it("flush emits a pending hold whose threshold has elapsed", () => {
    const afterPress = step(
      INITIAL_STATE,
      { kind: "press", btn: "A", t: 0 },
      DEFAULT_TIMING,
    );
    const flushed = flush(afterPress.state, 300);
    expect(flushed.gestures).toEqual([at(hold("A"), 250)]);
    expect(flushed.state.pendingHolds).toEqual([]);
  });

  it("flush at exactly the threshold does not emit (boundary)", () => {
    const afterPress = step(
      INITIAL_STATE,
      { kind: "press", btn: "A", t: 0 },
      DEFAULT_TIMING,
    );
    const flushed = flush(afterPress.state, 250);
    expect(flushed.gestures).toEqual([]);
    expect(flushed.state.pendingHolds).toEqual(afterPress.state.pendingHolds);
  });

  it("step is equivalent to recognize when folded over a timeline", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "press",   btn: "B", t: 50 },
      { kind: "release", btn: "A", t: 600 },
      { kind: "release", btn: "B", t: 700 },
    ];

    let state: RecognizerState = INITIAL_STATE;
    const gestures = [];
    for (const e of events) {
      const out = step(state, e, DEFAULT_TIMING);
      state = out.state;
      gestures.push(...out.gestures);
    }
    const flushed = flush(state, events[events.length - 1].t);
    gestures.push(...flushed.gestures);

    expect(gestures).toEqual(recognize(events).gestures);
  });

  it("custom timing flows through step", () => {
    const out = step(
      INITIAL_STATE,
      { kind: "press", btn: "A", t: 0 },
      { ...DEFAULT_TIMING, holdMs: 100 },
    );
    expect(out.state.pendingHolds).toEqual([{ btn: "A", scheduledAt: 100 }]);
  });
});
