// src/lib/gamepad/recognizer.ts
//
// Stage 2 of the gamepad pipeline: pure recognition of structurally-
// implied gestures from a logical event timeline.
//
// The recognizer is binding-blind. It emits every gesture that the
// timeline structurally implies (a tap, plus possibly a hold, plus
// possibly held ticks, plus eventually a doubleTap on the same press);
// the dispatcher decides what to actually fire based on the active
// layer's bindings.
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

import {
  at,
  chordFromArray,
  doubleTap,
  flick,
  held,
  hold,
  tap,
} from "./gestures";
import {
  assertNever,
  type AxisFrame,
  type ButtonName,
  type Direction,
  type GestureEvent,
  type LogicalEvent,
  type RecognitionOutput,
  type StickName,
} from "./types";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/**
 * Recognizer timing constants. Defaults match the spec's stated values.
 * Tests override individual fields via `recognize(events, { timing: {...} })`
 * or by passing a custom `Timing` to `step`.
 *
 * As later cycles add primitives, this type grows: doubleTapMs,
 * chordGraceMs, flickThreshold, etc.
 */
export type Timing = {
  /** T_hold: a press held strictly longer than this emits `hold`. */
  readonly holdMs: number;
  /** Initial delay before the first `held` tick. */
  readonly heldInitialMs: number;
  /** Interval between subsequent `held` ticks. MUST be > 0. */
  readonly heldRepeatMs: number;
  /**
   * Maximum elapsed time (inclusive) between the earliest still-held
   * press and a new press for the new press to form a chord with the
   * earlier ones. Comparison is `<=` (a press at exactly grace counts
   * as part of the chord).
   */
  readonly chordGraceMs: number;
  /**
   * Magnitude below which a stick reading is reported as exactly (0, 0).
   * Filters jitter; defines what "centred" means for re-arming flicks.
   */
  readonly stickDeadzone: number;
  /**
   * Minimum stick magnitude (inclusive ≥) that emits a flick gesture
   * when the stick is armed. Re-arms only after the stick returns to
   * the deadzone.
   */
  readonly flickThreshold: number;
  /**
   * Maximum elapsed time (inclusive ≤) between the first press and a
   * second press of the same button for the second press to fire a
   * doubleTap. Measured press-to-press (matches OS double-click).
   */
  readonly doubleTapMs: number;
};

export const DEFAULT_TIMING: Timing = Object.freeze({
  holdMs: 250,
  heldInitialMs: 300,
  heldRepeatMs: 60,
  chordGraceMs: 30,
  stickDeadzone: 0.12,
  flickThreshold: 0.7,
  doubleTapMs: 300,
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** One pending one-shot hold timer. Internal — not exported. */
type PendingHold = {
  readonly btn: ButtonName;
  readonly scheduledAt: number;
};

/**
 * One pending recurring `held` timer. After each emission the entry's
 * `nextAt` advances by `repeatMs` and `nextN` increments. `repeatMs` is
 * captured at press time so flush() doesn't need timing to advance.
 * `pressedAt` is captured for chord detection (lookback from a later
 * press's t). Internal — not exported. Note: pendingHelds doubles as
 * the canonical "currently held" set, since each press adds exactly one
 * entry and release removes it.
 */
type PendingHeld = {
  readonly btn: ButtonName;
  readonly nextAt: number;
  readonly nextN: number;
  readonly repeatMs: number;
  readonly pressedAt: number;
};

/**
 * Per-stick state for axis processing. `armed` flips between true (a
 * flick is allowed) and false (already flicked; waiting for re-arm by
 * returning to the deadzone). `lastEmittedX/Y` are the post-deadzone
 * values that produced the most recent AxisFrame (or the initial
 * (0,0)) — used to detect changes worth a new frame.
 */
export type StickState = {
  readonly armed: boolean;
  readonly lastEmittedX: number;
  readonly lastEmittedY: number;
};

const INITIAL_STICK_STATE: StickState = Object.freeze({
  armed: true,
  lastEmittedX: 0,
  lastEmittedY: 0,
});

/**
 * Immutable recognizer state, threaded across `step` calls. Production
 * holds the latest value between polling ticks; tests usually start
 * from `INITIAL_STATE` per case.
 */
export type RecognizerState = {
  readonly pendingHolds: readonly PendingHold[];
  readonly pendingHelds: readonly PendingHeld[];
  readonly sticks: Readonly<Record<StickName, StickState>>;
  /**
   * Time of the most-recent fully-completed (released) press of each
   * button. Set on release; consulted on press for doubleTap detection.
   */
  readonly previousPresses: Readonly<Partial<Record<ButtonName, number>>>;
};

export const INITIAL_STATE: RecognizerState = Object.freeze({
  pendingHolds: [],
  pendingHelds: [],
  sticks: {
    LeftStick:  INITIAL_STICK_STATE,
    RightStick: INITIAL_STICK_STATE,
  },
  previousPresses: {},
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
 * Emit pending one-shot holds and recurring helds whose scheduled time
 * is STRICTLY less than `upTo`, in chronological order. "Strictly"
 * implements the spec's "held continuously past" semantics.
 *
 * Each emission of a held entry re-schedules it forward by `repeatMs`
 * and increments `nextN`. The loop terminates when no entry is due.
 *
 * Tie-break when a hold and a held would fire at the same moment:
 * the hold fires first (it is rarer and one-shot).
 */
function catchUp(
  state: RecognizerState,
  upTo: number,
): { state: RecognizerState; gestures: GestureEvent[] } {
  let pendingHolds = state.pendingHolds;
  let pendingHelds = state.pendingHelds;
  const gestures: GestureEvent[] = [];

  while (true) {
    const holdAt = pendingHolds[0]?.scheduledAt ?? Number.POSITIVE_INFINITY;
    const heldEarliest = findEarliestHeld(pendingHelds);
    const heldAt = heldEarliest?.entry.nextAt ?? Number.POSITIVE_INFINITY;

    const earliest = Math.min(holdAt, heldAt);
    if (earliest >= upTo) break;

    if (holdAt <= heldAt) {
      const p = pendingHolds[0];
      gestures.push(at(hold(p.btn), p.scheduledAt));
      pendingHolds = pendingHolds.slice(1);
    } else {
      const idx = heldEarliest!.idx;
      const h = pendingHelds[idx];
      gestures.push(at(held(h.btn, h.nextN), h.nextAt));
      pendingHelds = replaceAt(pendingHelds, idx, {
        ...h,
        nextAt: h.nextAt + h.repeatMs,
        nextN: h.nextN + 1,
      });
    }
  }

  if (pendingHolds === state.pendingHolds && pendingHelds === state.pendingHelds) {
    return { state, gestures };
  }
  return {
    state: { ...state, pendingHolds, pendingHelds },
    gestures,
  };
}

/** Find the index and entry of the held with the smallest `nextAt`, if any. */
function findEarliestHeld(
  pending: readonly PendingHeld[],
): { idx: number; entry: PendingHeld } | null {
  if (pending.length === 0) return null;
  let bestIdx = 0;
  let bestAt = pending[0].nextAt;
  for (let i = 1; i < pending.length; i++) {
    if (pending[i].nextAt < bestAt) {
      bestIdx = i;
      bestAt = pending[i].nextAt;
    }
  }
  return { idx: bestIdx, entry: pending[bestIdx] };
}

/** Pure replace-by-index. */
function replaceAt<T>(arr: readonly T[], idx: number, value: T): readonly T[] {
  return [...arr.slice(0, idx), value, ...arr.slice(idx + 1)];
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

/** Remove the first pending-held entry for `btn` (FIFO). */
function removeFirstPendingHeld(
  pending: readonly PendingHeld[],
  btn: ButtonName,
): readonly PendingHeld[] {
  const idx = pending.findIndex(p => p.btn === btn);
  if (idx < 0) return pending;
  return [...pending.slice(0, idx), ...pending.slice(idx + 1)];
}

/**
 * Apply the magnitude-based deadzone: stick readings whose magnitude
 * is strictly less than the deadzone are reported as exactly (0, 0).
 */
function applyDeadzone(
  x: number,
  y: number,
  deadzone: number,
): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { x: 0, y: 0 };
  return { x, y };
}

/**
 * Determine the cardinal direction of a stick reading. Whichever of
 * `|x|` and `|y|` is larger picks the axis; sign picks the direction.
 * On exact equality (45° diagonals), prefer horizontal. Returns null
 * when both components are zero (no direction).
 *
 * Convention: y > 0 is "down" (screen coordinates).
 */
function directionOf(x: number, y: number): Direction | null {
  if (x === 0 && y === 0) return null;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax >= ay) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
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
  if (timing.heldRepeatMs <= 0) {
    throw new RangeError(
      `step: timing.heldRepeatMs must be > 0, got ${timing.heldRepeatMs}`,
    );
  }

  // Surface any holds/helds whose threshold elapsed before this event.
  const caught = catchUp(state, event.t);
  const gestures: GestureEvent[] = [...caught.gestures];
  const axes: AxisFrame[] = [];
  let next = caught.state;

  switch (event.kind) {
    case "press": {
      gestures.push(at(tap(event.btn), event.t));

      // Chord detection: any currently-held button whose press time is
      // within chordGraceMs (inclusive) of this press? If so, emit a
      // chord including all such buttons + this one.
      const recent = next.pendingHelds.filter(
        h => event.t - h.pressedAt <= timing.chordGraceMs,
      );
      if (recent.length >= 1) {
        gestures.push(
          at(
            chordFromArray([...recent.map(h => h.btn), event.btn]),
            event.t,
          ),
        );
      }

      // DoubleTap detection: was the most recent fully-completed press
      // of this same button within doubleTapMs of this press?
      const prevPress = next.previousPresses[event.btn];
      if (prevPress !== undefined && event.t - prevPress <= timing.doubleTapMs) {
        gestures.push(at(doubleTap(event.btn), event.t));
      }

      next = {
        ...next,
        pendingHolds: [
          ...next.pendingHolds,
          { btn: event.btn, scheduledAt: event.t + timing.holdMs },
        ],
        pendingHelds: [
          ...next.pendingHelds,
          {
            btn: event.btn,
            nextAt: event.t + timing.heldInitialMs,
            nextN: 1,
            repeatMs: timing.heldRepeatMs,
            pressedAt: event.t,
          },
        ],
      };
      break;
    }
    case "release": {
      // Capture the press time of the cycle just completing so a future
      // press of the same button can form a doubleTap. The press info
      // lives on the matching pendingHelds entry until release.
      const released = next.pendingHelds.find(p => p.btn === event.btn);
      next = {
        ...next,
        pendingHolds: removeFirstPendingHold(next.pendingHolds, event.btn),
        pendingHelds: removeFirstPendingHeld(next.pendingHelds, event.btn),
        previousPresses: released
          ? { ...next.previousPresses, [event.btn]: released.pressedAt }
          : next.previousPresses,
      };
      break;
    }
    case "axis": {
      const dz = applyDeadzone(event.x, event.y, timing.stickDeadzone);
      const prev = next.sticks[event.stick];

      // Emit AxisFrame on any post-deadzone change for this stick.
      if (dz.x !== prev.lastEmittedX || dz.y !== prev.lastEmittedY) {
        axes.push({
          stick: event.stick,
          x: dz.x,
          y: dz.y,
          t: event.t,
        });
      }

      // Compute next armed state and possibly emit a flick.
      const mag = Math.hypot(dz.x, dz.y);
      let armed = prev.armed;
      if (mag === 0) {
        armed = true; // returning to deadzone re-arms
      } else if (armed && mag >= timing.flickThreshold) {
        const dir = directionOf(dz.x, dz.y);
        if (dir !== null) {
          gestures.push(at(flick(event.stick, dir), event.t));
          armed = false;
        }
      }

      next = {
        ...next,
        sticks: {
          ...next.sticks,
          [event.stick]: {
            armed,
            lastEmittedX: dz.x,
            lastEmittedY: dz.y,
          },
        },
      };
      break;
    }
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
