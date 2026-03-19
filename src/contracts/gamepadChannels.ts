// src/contracts/gamepadChannels.ts
//
// Typed pub/sub channels for gamepad intents. The gamepad polling module
// publishes high-level intents here; subscribers (editor navigation, menu
// bridge, manual control bridge) react to them without the gamepad module
// needing to know about menus, themes, or editor internals.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

// ── Intent payloads ─────────────────────────────────────────────

/** D-pad / directional navigation intent. */
export interface NavigateIntent {
  direction: "up" | "down" | "left" | "right";
  /** Whether this is a repeat (held button) rather than a fresh press. */
  repeat: boolean;
}

/** Enter / drill-in intent (A button). */
export interface EnterIntent {}

/** Back / drill-out intent (B button). */
export interface BackIntent {}

/** Toggle navigation mode (spatial ↔ structural). */
export interface ToggleNavModeIntent {}

/** Evaluate the current editor content (Start button). */
export interface EvalIntent {}

/** Delete the node at the cursor (Y button). */
export interface DeleteNodeIntent {}

/** Number adjustment at cursor (LB / RB bumpers). */
export interface AdjustNumberIntent {
  delta: number;
}

/** Open a create / insert menu (LB+A = before, RB+A = after). */
export interface OpenMenuIntent {
  direction: "before" | "after";
}

/** Open the double-radial create menu (X button → "replace"). */
export interface OpenRadialMenuIntent {
  direction: "replace";
}

/** Toggle manual control binding for a stick. */
export interface ToggleManualControlIntent {
  stick: "left" | "right";
}

/** Stick axis values for manual control updates. */
export interface StickAxisUpdate {
  stick: "left" | "right";
  x: number;
  y: number;
}

// ── Picker-mode intents (gamepad → menu components) ─────────────

/** Directional input while a picker/menu is open. */
export interface PickerNavigateIntent {
  direction?: "up" | "down" | "left" | "right";
  leftStick?: { x: number; y: number };
  rightStick?: { x: number; y: number };
}

/** Picker confirm / select action. */
export interface PickerSelectIntent {}

/** Picker cancel action. */
export interface PickerCancelIntent {}

/** Picker apply action (for radial menu modes). */
export interface PickerApplyIntent {
  mode: "replace" | "apply_call" | "apply_pre" | "apply";
}

// ── Channels ────────────────────────────────────────────────────

/** Directional navigation (d-pad). */
export const navigate: TypedChannel<NavigateIntent> = createChannel();

/** Enter / drill-in. */
export const enter: TypedChannel<EnterIntent> = createChannel();

/** Back / drill-out. */
export const back: TypedChannel<BackIntent> = createChannel();

/** Toggle navigation mode. */
export const toggleNavMode: TypedChannel<ToggleNavModeIntent> = createChannel();

/** Evaluate editor content. */
export const evalNow: TypedChannel<EvalIntent> = createChannel();

/** Delete node at cursor. */
export const deleteNode: TypedChannel<DeleteNodeIntent> = createChannel();

/** Adjust number at cursor. */
export const adjustNumber: TypedChannel<AdjustNumberIntent> = createChannel();

/** Open create menu. */
export const openMenu: TypedChannel<OpenMenuIntent> = createChannel();

/** Open radial create menu. */
export const openRadialMenu: TypedChannel<OpenRadialMenuIntent> = createChannel();

/** Toggle manual control. */
export const toggleManualControl: TypedChannel<ToggleManualControlIntent> = createChannel();

/** Stick axis update for manual control. */
export const stickAxis: TypedChannel<StickAxisUpdate> = createChannel();

// ── Picker-mode channels ────────────────────────────────────────

/** Directional input while a picker is open. */
export const pickerNavigate: TypedChannel<PickerNavigateIntent> = createChannel();

/** Picker select/confirm. */
export const pickerSelect: TypedChannel<PickerSelectIntent> = createChannel();

/** Picker cancel. */
export const pickerCancel: TypedChannel<PickerCancelIntent> = createChannel();

/** Picker apply (radial menu modes). */
export const pickerApply: TypedChannel<PickerApplyIntent> = createChannel();

// ── Mode channel (menu bridge → intent emitter) ─────────────────

/** Current controller mode, published by the menu bridge so the intent
 *  emitter knows whether to emit normal-mode or picker-mode intents. */
export type ControllerMode = "normal" | "picker" | "number-picker" | "loading-picker";
export const controllerMode: TypedChannel<ControllerMode> = createChannel();

// ── Re-export ───────────────────────────────────────────────────

export type { TypedChannel };
