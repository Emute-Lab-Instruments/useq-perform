// src/lib/gamepad/types.ts
//
// Type-only module. The shape of every value flowing through the gamepad
// pipeline is defined here. See docs/specs/gamepad.md §3–§7 for the
// normative ontology.

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
// Stage 3 — Bindings, layers, resolution (spec §4–§5)
// ---------------------------------------------------------------------------

import type {
  ActionId,
  ReversibleActionId,
} from "../keybindings/actions";

export type { ActionId, ReversibleActionId };

export type AxisChannelName = string & { readonly __brand: "AxisChannelName" };

export type PopPolicy =
  | "resolution"
  | "miss-or-cancel"
  | "timeout"
  | "predicate";

export type MissPolicy =
  | "fall-through"
  | "pop-and-fall-through"
  | "pop-and-discard"
  | "noop-flash";

export type DualBinding = {
  readonly tap?: ReversibleActionId;
  readonly hold?: ActionId;
  readonly held?: ActionId;
};

export type GestureBindings = Readonly<
  Record<GestureKey, ActionId | DualBinding>
>;

export type LeaderBindings = Readonly<Record<GestureKey, LayerName>>;

export type AxisBindings = Readonly<
  Partial<Record<"left" | "right", AxisChannelName>>
>;

export type LayerName = string & { readonly __brand: "LayerName" };

export type Layer = {
  readonly name: LayerName;
  readonly when?: (state: AppStateSnapshot) => boolean;
  readonly gestures?: GestureBindings;
  readonly axes?: AxisBindings;
  readonly leaders?: LeaderBindings;
  readonly popOn?: readonly PopPolicy[];
  readonly onMiss?: MissPolicy;
  readonly ttlMs?: number;
  readonly cancelGesture?: Gesture;
  /**
   * When `true`, this layer is **exclusive**: while active, any gesture it does
   * not bind is discarded rather than falling through to lower layers. This
   * gives a predicate-driven layer (e.g. the radial menu, which is registered
   * as a permanent `when`-gated layer rather than a transient push) the same
   * full input-takeover semantics that `onMiss` provides for transient layers.
   *
   * Unbound gestures resolve to a `miss` with `pop-and-discard` policy and the
   * resolver stops walking the stack. See radial-menu.md §1.1 / §12.6.
   */
  readonly mask?: boolean;
};

export type TransientLayerEntry = {
  readonly name: LayerName;
  readonly pushedAt: number;
  readonly expiresAt: number | null;
};

export type GamepadState = {
  readonly heldButtons: ReadonlySet<ButtonName>;
  readonly transientLayers: readonly TransientLayerEntry[];
  readonly lastInputAt: number;
  readonly stickPositions: Readonly<
    Record<StickName, { x: number; y: number }>
  >;
};

export type AppStateSnapshot = {
  readonly gamepad: GamepadState;
  readonly [key: string]: unknown;
};

export type Resolution =
  | { readonly kind: "action"; readonly action: ActionId; readonly gesture: Gesture }
  | { readonly kind: "dual"; readonly binding: DualBinding; readonly gesture: Gesture }
  | { readonly kind: "leader"; readonly layerName: LayerName; readonly gesture: Gesture }
  | { readonly kind: "axis"; readonly channel: AxisChannelName; readonly stick: StickName; readonly frame: AxisFrame }
  | { readonly kind: "miss"; readonly gesture: Gesture; readonly policy: MissPolicy };

export function isDualBinding(
  value: ActionId | DualBinding,
): value is DualBinding {
  return typeof value === "object" && value !== null;
}

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
