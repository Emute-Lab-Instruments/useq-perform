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

import { at, tap } from "./gestures";
import { recognize } from "./recognizer";
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
    const events: readonly LogicalEvent[] = [
      { kind: "press",   btn: "X", t: 1234 },
      { kind: "release", btn: "X", t: 1500 },
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
