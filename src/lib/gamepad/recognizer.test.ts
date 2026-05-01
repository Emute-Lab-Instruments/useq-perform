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

import { at, hold, tap } from "./gestures";
import {
  DEFAULT_TIMING,
  INITIAL_STATE,
  flush,
  recognize,
  step,
  type RecognizerState,
} from "./recognizer";
import type { LogicalEvent } from "./types";

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
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "A", t: 0 },
      { kind: "press", btn: "B", t: 1 },
      { kind: "press", btn: "X", t: 2 },
    ];
    expect(recognize(events).gestures.map(g => g.gesture)).toEqual([
      tap("A"), tap("B"), tap("X"),
    ]);
  });

  it("simultaneous-timestamp presses preserve input order", () => {
    // Simultaneous polls (same t) MUST be ordered deterministically
    // by their position in the input stream.
    const events: readonly LogicalEvent[] = [
      { kind: "press", btn: "B", t: 100 },
      { kind: "press", btn: "A", t: 100 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("B"), 100),
      at(tap("A"), 100),
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
      { kind: "axis", name: "LeftStickX", x: 0.5, y: 0, t: 50 },
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
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "press",   btn: "B", t: 50 },
      { kind: "release", btn: "A", t: 600 },
      { kind: "release", btn: "B", t: 700 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 50),
      at(hold("A"), 250),
      at(hold("B"), 300),
    ]);
  });

  it("releasing one button only cancels its own pending hold", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0 },
      { kind: "press",   btn: "B", t: 50 },
      { kind: "release", btn: "A", t: 100 },  // A: well before threshold
      { kind: "release", btn: "B", t: 600 },  // B: well past threshold
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
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 100 },
      { kind: "release", btn: "A", t: 999 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 100),
      at(hold("A"), 350), // 100 + 250, NOT 999
    ]);
  });

  it("catch-up emits multiple due holds in scheduledAt order", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0    },
      { kind: "press",   btn: "B", t: 100  },
      { kind: "release", btn: "A", t: 1000 },
      { kind: "release", btn: "B", t: 1100 },
    ];
    expect(recognize(events).gestures).toEqual([
      at(tap("A"), 0),
      at(tap("B"), 100),
      at(hold("A"), 250),
      at(hold("B"), 350),
    ]);
  });

  it("is deterministic with hold timers", () => {
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "A", t: 0   },
      { kind: "press",   btn: "B", t: 50  },
      { kind: "release", btn: "A", t: 350 },
      { kind: "release", btn: "B", t: 400 },
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
    expect(INITIAL_STATE).toEqual({ pendingHolds: [] });
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

  it("step on an axis event leaves state unchanged", () => {
    const after = step(
      INITIAL_STATE,
      { kind: "axis", name: "LeftStickX", x: 0.5, y: 0, t: 0 },
      DEFAULT_TIMING,
    );
    expect(after.state).toEqual(INITIAL_STATE);
    expect(after.gestures).toEqual([]);
    expect(after.axes).toEqual([]);
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
      { holdMs: 100 },
    );
    expect(out.state.pendingHolds).toEqual([{ btn: "A", scheduledAt: 100 }]);
  });
});
