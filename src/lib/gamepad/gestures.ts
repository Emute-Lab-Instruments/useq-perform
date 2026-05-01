// src/lib/gamepad/gestures.ts
//
// Smart constructors for Gesture values, plus `keyOf` — the canonical
// string projection used for binding-table lookup. Pure module; no
// runtime imports beyond `./types`.
//
// Runtime invariants enforced here:
//   - chord() requires ≥ 2 distinct buttons; canonicalises order via BUTTON_ORDER
//   - held() defaults n=1; n must be ≥ 1
//
// See docs/specs/gamepad.md §3.2 and §4.4.

import {
  BUTTON_ORDER,
  assertNever,
  type ButtonName,
  type ChordGesture,
  type DoubleTapGesture,
  type Direction,
  type FlickGesture,
  type Gesture,
  type GestureEvent,
  type GestureKey,
  type HeldGesture,
  type HoldGesture,
  type StickName,
  type TapGesture,
} from "./types";

// ---------------------------------------------------------------------------
// Button ordering — used to canonicalise chord button lists
// ---------------------------------------------------------------------------

const BUTTON_RANK: Readonly<Record<ButtonName, number>> = (() => {
  const ranks = {} as Record<ButtonName, number>;
  for (let i = 0; i < BUTTON_ORDER.length; i++) {
    ranks[BUTTON_ORDER[i]] = i;
  }
  return ranks;
})();

/** Compare two ButtonNames by canonical declaration order. */
export function compareButtons(a: ButtonName, b: ButtonName): number {
  return BUTTON_RANK[a] - BUTTON_RANK[b];
}

// ---------------------------------------------------------------------------
// Smart constructors
// ---------------------------------------------------------------------------

export function tap(btn: ButtonName): TapGesture {
  return Object.freeze({ kind: "tap", btn });
}

export function hold(btn: ButtonName): HoldGesture {
  return Object.freeze({ kind: "hold", btn });
}

export function held(btn: ButtonName, n: number = 1): HeldGesture {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`held: n must be an integer ≥ 1, got ${n}`);
  }
  return Object.freeze({ kind: "held", btn, n });
}

export function doubleTap(btn: ButtonName): DoubleTapGesture {
  return Object.freeze({ kind: "doubleTap", btn });
}

/**
 * Construct a chord gesture. Compile-time tuple constraint requires ≥ 2
 * buttons; runtime check enforces distinctness; the returned `btns` is
 * canonicalised by BUTTON_ORDER so `chord(['LB','A'])` and `chord(['A','LB'])`
 * are deeply equal.
 */
export function chord<
  const B extends readonly [ButtonName, ButtonName, ...ButtonName[]],
>(btns: B): ChordGesture {
  if (new Set(btns).size !== btns.length) {
    throw new RangeError(
      `chord: buttons must be distinct, got [${btns.join(", ")}]`,
    );
  }
  const sorted = [...btns].sort(compareButtons) as unknown as ChordGesture["btns"];
  return Object.freeze({ kind: "chord", btns: sorted });
}

export function flick(stick: StickName, dir: Direction): FlickGesture {
  return Object.freeze({ kind: "flick", stick, dir });
}

// ---------------------------------------------------------------------------
// GestureEvent helper (structural Gesture + timestamp)
// ---------------------------------------------------------------------------

/** Tag a gesture with the moment it fired. Used in recognizer output. */
export function at(gesture: Gesture, t: number): GestureEvent {
  return Object.freeze({ gesture, t });
}

// ---------------------------------------------------------------------------
// keyOf — canonical lookup key for binding tables
// ---------------------------------------------------------------------------

/**
 * Project a Gesture to its canonical string key. Two gestures with the
 * same structural identity (per spec §3.2) project to the same key:
 *
 *   keyOf(tap('A'))                 → 'tap:A'
 *   keyOf(hold('Start'))            → 'hold:Start'
 *   keyOf(held('Up'))               → 'held:Up'        (n stripped)
 *   keyOf(held('Up', 5))            → 'held:Up'        (n stripped)
 *   keyOf(doubleTap('A'))           → 'doubleTap:A'
 *   keyOf(chord(['LB','A']))        → 'chord:A+LB'     (canonical order)
 *   keyOf(chord(['Y','LB','A']))    → 'chord:A+Y+LB'   (sort by BUTTON_ORDER)
 *   keyOf(flick('LeftStick','up'))  → 'flick:LeftStick:up'
 */
export function keyOf(g: Gesture): GestureKey {
  switch (g.kind) {
    case "tap":       return `tap:${g.btn}` as GestureKey;
    case "hold":      return `hold:${g.btn}` as GestureKey;
    case "held":      return `held:${g.btn}` as GestureKey;
    case "doubleTap": return `doubleTap:${g.btn}` as GestureKey;
    case "chord":     return `chord:${g.btns.join("+")}` as GestureKey;
    case "flick":     return `flick:${g.stick}:${g.dir}` as GestureKey;
  }
  return assertNever(g, `keyOf: unhandled gesture kind`);
}
