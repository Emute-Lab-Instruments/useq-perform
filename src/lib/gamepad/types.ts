// src/lib/gamepad/types.ts
//
// Type-only module. The shape of every value flowing through the gamepad
// pipeline is defined here. No logic; no imports from anywhere else in
// the project. See docs/specs/gamepad.md §3 for the normative ontology.

// ---------------------------------------------------------------------------
// Button / stick / axis names
// ---------------------------------------------------------------------------

/**
 * Canonical declaration order for ButtonName. Used for the literal union
 * AND as the canonical sort order for chord button lists. Adding a button
 * here is the only place a new ButtonName needs to be declared.
 */
export const BUTTON_ORDER = [
  "A", "B", "X", "Y",
  "LB", "RB", "LT", "RT",
  "Up", "Down", "Left", "Right",
  "Start", "Back",
  "LeftStickPress", "RightStickPress",
] as const;

export type ButtonName = typeof BUTTON_ORDER[number];

export const STICK_NAMES = ["LeftStick", "RightStick"] as const;
export type StickName = typeof STICK_NAMES[number];

export const DIRECTIONS = ["up", "down", "left", "right"] as const;
export type Direction = typeof DIRECTIONS[number];

// ---------------------------------------------------------------------------
// Stage 1 — LogicalEvent
// ---------------------------------------------------------------------------

export type LogicalEvent =
  | { readonly kind: "press";   readonly btn: ButtonName; readonly t: number }
  | { readonly kind: "release"; readonly btn: ButtonName; readonly t: number }
  | {
      readonly kind: "axis";
      readonly stick: StickName;
      readonly x: number;
      readonly y: number;
      readonly t: number;
    };

// ---------------------------------------------------------------------------
// Stage 2 — Gesture (discrete) and AxisFrame (continuous)
// ---------------------------------------------------------------------------

/**
 * The structural identity of a gesture. Timeless: timestamps are carried
 * separately on `GestureEvent` so that `Gesture` is structurally hashable
 * for binding-table lookup. See spec §3.2 and §4.4.
 */
export type Gesture =
  | { readonly kind: "tap";       readonly btn: ButtonName }
  | { readonly kind: "hold";      readonly btn: ButtonName }
  | { readonly kind: "held";      readonly btn: ButtonName; readonly n: number }
  | { readonly kind: "doubleTap"; readonly btn: ButtonName }
  | {
      readonly kind: "chord";
      readonly btns: readonly [ButtonName, ButtonName, ...ButtonName[]];
    }
  | {
      readonly kind: "flick";
      readonly stick: StickName;
      readonly dir: Direction;
    };

export type TapGesture       = Extract<Gesture, { kind: "tap" }>;
export type HoldGesture      = Extract<Gesture, { kind: "hold" }>;
export type HeldGesture      = Extract<Gesture, { kind: "held" }>;
export type DoubleTapGesture = Extract<Gesture, { kind: "doubleTap" }>;
export type ChordGesture     = Extract<Gesture, { kind: "chord" }>;
export type FlickGesture     = Extract<Gesture, { kind: "flick" }>;

/** A gesture occurrence — the structural Gesture plus the moment it fired. */
export type GestureEvent = {
  readonly gesture: Gesture;
  readonly t: number;
};

/** A continuous stick reading. Emitted at the polling cadence when changed. */
export type AxisFrame = {
  readonly stick: StickName;
  readonly x: number;
  readonly y: number;
  readonly t: number;
};

/** The pure output of Stage 2 (recognition). */
export type RecognitionOutput = {
  readonly gestures: readonly GestureEvent[];
  readonly axes:     readonly AxisFrame[];
};

// ---------------------------------------------------------------------------
// GestureKey — canonical string lookup key for binding tables
// ---------------------------------------------------------------------------

/**
 * Branded string type. Produced by `keyOf(gesture)` in `gestures.ts`.
 * Authors never type these strings; they're an internal canonical form.
 */
export type GestureKey = string & { readonly __brand: "GestureKey" };

// ---------------------------------------------------------------------------
// Exhaustiveness helper
// ---------------------------------------------------------------------------

/**
 * Compile-time exhaustiveness assertion. Used in switch statements over
 * discriminated unions to guarantee every variant is handled. Adding a
 * new union member without updating the switch becomes a TS error.
 */
export function assertNever(x: never, msg?: string): never {
  throw new Error(msg ?? `assertNever: unexpected value ${JSON.stringify(x)}`);
}
