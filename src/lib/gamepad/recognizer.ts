// src/lib/gamepad/recognizer.ts
//
// Stage 2 of the gamepad pipeline: pure recognition of structurally-
// implied gestures from a logical event timeline.
//
// The recognizer is binding-blind. It emits every gesture that the
// timeline structurally implies (a tap, plus possibly a hold, plus
// possibly a doubleTap on the same press); the dispatcher decides
// what to actually fire based on the active layer's bindings.
//
// API shape:
//   step(state, event, timing)         → { state, gestures, axes }
//   flush(state, evaluateUpTo)         → { state, gestures, axes }
//   recognize(events, options) — batch wrapper that folds step + flush
//
// `step` and `flush` are pure functions. Production calls them
// incrementally as new events arrive from the polling loop, retaining
// the returned `state` between calls. Tests typically use `recognize`
// for terse end-to-end goldens, but may drive `step` directly to assert
// per-event invariants.
//
// Cycle 2 — tap.
// Cycle 3 — hold.
// Cycle 3.5 — refactor to step/flush + batch wrapper.

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
 * Tests override individual fields via `recognize(events, { timing: {...} })`
 * or by passing a custom `Timing` to `step`.
 *
 * As later cycles add primitives, this type grows: heldInitialMs,
 * heldRepeatMs, doubleTapMs, chordGraceMs, flickThreshold, etc.
 */
export type Timing = {
  /** T_hold: a press held strictly longer than this emits `hold`. */
  readonly holdMs: number;
};

export const DEFAULT_TIMING: Timing = Object.freeze({
  holdMs: 250,
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * One pending-hold timer. Recognizer state holds these in scheduledAt-
 * ascending order. Internal — not exported.
 */
type PendingHold = {
  readonly btn: ButtonName;
  readonly scheduledAt: number;
};

/**
 * Immutable recognizer state, threaded across `step` calls. Production
 * holds the latest value between polling ticks; tests usually start
 * from `INITIAL_STATE` per case.
 *
 * As later cycles add primitives, this type grows additional fields:
 * pendingHelds, lastReleased (per-button for doubleTap), armedFlicks
 * (per-stick), etc.
 */
export type RecognizerState = {
  readonly pendingHolds: readonly PendingHold[];
};

export const INITIAL_STATE: RecognizerState = Object.freeze({
  pendingHolds: [],
});

// ---------------------------------------------------------------------------
// Step output + options
// ---------------------------------------------------------------------------

export type StepOutput = {
  readonly state: RecognizerState;
  readonly gestures: readonly GestureEvent[];
  readonly axes: readonly AxisFrame[];
};

export type RecognizerOptions = {
  /**
   * Logical "now" — gestures whose timer would fire strictly before this
   * timestamp are flushed at the end of the batch. Defaults to the
   * timestamp of the last event in the stream, or 0 for empty input.
   */
  readonly evaluateUpTo?: number;
  readonly timing?: Partial<Timing>;
};

// ---------------------------------------------------------------------------
// Pure helpers (private)
// ---------------------------------------------------------------------------

/**
 * Emit pending holds whose scheduledAt is STRICTLY less than `upTo`.
 * "Strictly" implements the spec's "held continuously past T_hold".
 * Returns the trimmed state and the emitted gestures.
 */
function catchUp(
  state: RecognizerState,
  upTo: number,
): { state: RecognizerState; gestures: GestureEvent[] } {
  let i = 0;
  const gestures: GestureEvent[] = [];
  while (
    i < state.pendingHolds.length &&
    state.pendingHolds[i].scheduledAt < upTo
  ) {
    const p = state.pendingHolds[i];
    gestures.push(at(hold(p.btn), p.scheduledAt));
    i++;
  }
  if (i === 0) return { state, gestures };
  return {
    state: { ...state, pendingHolds: state.pendingHolds.slice(i) },
    gestures,
  };
}

/** Remove the first pending-hold entry for `btn` (FIFO across same-button presses). */
function removeFirstPendingHold(
  pending: readonly PendingHold[],
  btn: ButtonName,
): readonly PendingHold[] {
  const idx = pending.findIndex(p => p.btn === btn);
  if (idx < 0) return pending;
  return [...pending.slice(0, idx), ...pending.slice(idx + 1)];
}

// ---------------------------------------------------------------------------
// step — process one logical event
// ---------------------------------------------------------------------------

/**
 * Apply one logical event to the recognizer state. Pure: never mutates
 * input; returns a fresh state and any gestures/axes emitted by this
 * step (including timer expirations whose threshold falls at or before
 * the event's timestamp).
 */
export function step(
  state: RecognizerState,
  event: LogicalEvent,
  timing: Timing = DEFAULT_TIMING,
): StepOutput {
  // Surface any holds whose threshold elapsed before this event.
  const caught = catchUp(state, event.t);
  const gestures: GestureEvent[] = [...caught.gestures];
  const axes: AxisFrame[] = [];
  let next = caught.state;

  switch (event.kind) {
    case "press":
      gestures.push(at(tap(event.btn), event.t));
      next = {
        ...next,
        pendingHolds: [
          ...next.pendingHolds,
          { btn: event.btn, scheduledAt: event.t + timing.holdMs },
        ],
      };
      break;
    case "release":
      next = {
        ...next,
        pendingHolds: removeFirstPendingHold(next.pendingHolds, event.btn),
      };
      break;
    case "axis":
      // Flick cycle will detect threshold crossings here; later cycles
      // emit AxisFrames.
      break;
    default:
      assertNever(event, "step: unhandled LogicalEvent kind");
  }

  return { state: next, gestures, axes };
}

// ---------------------------------------------------------------------------
// flush — advance "now" without an event
// ---------------------------------------------------------------------------

/**
 * Advance the recognizer's logical clock to `evaluateUpTo` without
 * consuming an event. Emits any pending timer expirations whose
 * threshold falls strictly before that moment.
 *
 * Used both internally by the batch wrapper and externally in
 * production (e.g. polling tick with no new events: `flush(state, now)`).
 */
export function flush(
  state: RecognizerState,
  evaluateUpTo: number,
): StepOutput {
  const caught = catchUp(state, evaluateUpTo);
  return {
    state: caught.state,
    gestures: caught.gestures,
    axes: [],
  };
}

// ---------------------------------------------------------------------------
// recognize — batch wrapper (events → RecognitionOutput)
// ---------------------------------------------------------------------------

/**
 * Fold `step` over a logical event timeline, then `flush` to
 * `evaluateUpTo`. Equivalent to driving the incremental API across the
 * whole timeline at once. Same input → same output (pure).
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
  let state: RecognizerState = INITIAL_STATE;

  for (const e of events) {
    const out = step(state, e, timing);
    state = out.state;
    gestures.push(...out.gestures);
    axes.push(...out.axes);
  }

  const flushed = flush(state, evaluateUpTo);
  gestures.push(...flushed.gestures);
  axes.push(...flushed.axes);

  return { gestures, axes };
}
