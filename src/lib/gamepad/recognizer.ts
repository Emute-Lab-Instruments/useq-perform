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
// docs/specs/gamepad.md §8 + §9.
//
// Cycle 2 — tap only.

import { at, tap } from "./gestures";
import {
  assertNever,
  type AxisFrame,
  type GestureEvent,
  type LogicalEvent,
  type RecognitionOutput,
} from "./types";

/**
 * Recognize structurally-implied gestures from a logical event timeline.
 * Pure: same input always yields the same output; never mutates input.
 *
 * Cycle 2 contract:
 *   - Every `press` event emits a `tap` gesture at the press timestamp.
 *   - `release` events are silently consumed (no output yet).
 *   - `axis` events are silently consumed (deferred to flick cycle).
 *   - Output preserves input order; emission timestamps match press time.
 */
export function recognize(
  events: readonly LogicalEvent[],
): RecognitionOutput {
  const gestures: GestureEvent[] = [];
  const axes: AxisFrame[] = [];

  for (const e of events) {
    switch (e.kind) {
      case "press":
        gestures.push(at(tap(e.btn), e.t));
        break;
      case "release":
        // Cycle 3+ will use this to cancel hold timers, etc.
        break;
      case "axis":
        // Flick cycle will detect threshold crossings; later cycles
        // will emit AxisFrames here.
        break;
      default:
        assertNever(e, "recognize: unhandled LogicalEvent kind");
    }
  }

  return { gestures, axes };
}
