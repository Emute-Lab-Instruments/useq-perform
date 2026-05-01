// src/lib/gamepad/recognizer.ts
//
// Stage 2 of the gamepad pipeline: pure function from a stream of
// LogicalEvents to a stream of structurally-recognized gestures and
// continuous AxisFrames.
//
// The recognizer is binding-blind. It emits every gesture that the
// timeline structurally implies (a tap, plus possibly a hold, plus
// possibly a doubleTap on the same press); the dispatcher decides
// what to actually fire based on the active layer's bindings.
//
// This file grows one primitive at a time per the TDD plan in
// docs/specs/gamepad.md.
//
// Cycle 2 — tap.
// Cycle 3 — hold (this cycle adds timing + evaluateUpTo).

import { at, hold, tap } from "./gestures";
import {
  assertNever,
  type AxisFrame,
  type ButtonName,
  type GestureEvent,
  type LogicalEvent,
  type RecognitionOutput,
} from "./types";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/**
 * Recognizer timing constants. Defaults match the spec's stated values.
 * Tests override individual fields via `recognize(events, { timing: {...} })`.
 *
 * As later cycles add primitives, this type grows: heldInitialMs,
 * heldRepeatMs, doubleTapMs, chordGraceMs, flickThreshold, etc.
 */
export type Timing = {
  /** T_hold: a press held strictly longer than this emits `hold`. */
  readonly holdMs: number;
};

export const DEFAULT_TIMING: Timing = {
  holdMs: 250,
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type RecognizerOptions = {
  /**
   * Logical "now" — gestures whose timer would fire strictly before this
   * timestamp are emitted. Defaults to the timestamp of the last event in
   * the stream, or 0 for an empty stream.
   *
   * Pass a value past the last event to flush pending timers (e.g. to
   * test holds on an ongoing press, or to advance time without an event).
   */
  readonly evaluateUpTo?: number;
  readonly timing?: Partial<Timing>;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type PendingHold = {
  readonly btn: ButtonName;
  readonly scheduledAt: number; // = pressTime + timing.holdMs
};

// ---------------------------------------------------------------------------
// recognize
// ---------------------------------------------------------------------------

/**
 * Recognize structurally-implied gestures from a logical event timeline.
 * Pure: same input always yields the same output; never mutates input.
 *
 * Cycle 2/3 contract:
 *   - Every `press` event emits a `tap` gesture at the press timestamp.
 *   - A press held strictly past `timing.holdMs` emits `hold(btn)` at
 *     `pressTime + timing.holdMs`. Release at exactly the threshold does
 *     not count (strict). Held-and-still-pressed at end-of-stream emits
 *     hold iff `evaluateUpTo > scheduledAt`.
 *   - `axis` events are silently consumed (deferred to flick cycle).
 *   - Output preserves chronological order.
 */
export function recognize(
  events: readonly LogicalEvent[],
  options: RecognizerOptions = {},
): RecognitionOutput {
  const timing: Timing = { ...DEFAULT_TIMING, ...options.timing };
  const lastEventT = events.length > 0 ? events[events.length - 1].t : 0;
  const evaluateUpTo = options.evaluateUpTo ?? lastEventT;

  const gestures: GestureEvent[] = [];
  const axes: AxisFrame[] = [];

  // Pending holds, kept in scheduledAt order. Since we assume monotone
  // event timestamps (spec §3.1.1), and scheduledAt = e.t + holdMs,
  // append-on-press preserves the ordering invariant.
  const pendingHolds: PendingHold[] = [];

  /**
   * Emit any pending hold whose scheduledAt is STRICTLY less than `upTo`.
   * "Strictly" implements the spec's "held continuously past T_hold".
   */
  function emitDueHolds(upTo: number): void {
    while (pendingHolds.length > 0 && pendingHolds[0].scheduledAt < upTo) {
      const p = pendingHolds.shift()!;
      gestures.push(at(hold(p.btn), p.scheduledAt));
    }
  }

  /** Cancel the first pending hold for `btn` (FIFO across same-button presses). */
  function cancelPendingHold(btn: ButtonName): void {
    const idx = pendingHolds.findIndex(p => p.btn === btn);
    if (idx >= 0) pendingHolds.splice(idx, 1);
  }

  for (const e of events) {
    // Before processing the event, surface any holds whose threshold
    // was crossed in the time since the previous event. The hold's
    // gesture timestamp is the threshold time (scheduledAt), not the
    // surfacing event's time — see Cycle 3 spec.
    emitDueHolds(e.t);

    switch (e.kind) {
      case "press":
        gestures.push(at(tap(e.btn), e.t));
        pendingHolds.push({ btn: e.btn, scheduledAt: e.t + timing.holdMs });
        break;
      case "release":
        cancelPendingHold(e.btn);
        break;
      case "axis":
        // Flick cycle will detect threshold crossings; later cycles
        // will emit AxisFrames here.
        break;
      default:
        assertNever(e, "recognize: unhandled LogicalEvent kind");
    }
  }

  // After all events, flush any holds whose threshold was crossed before
  // `evaluateUpTo`. Strict less-than per spec.
  emitDueHolds(evaluateUpTo);

  return { gestures, axes };
}
