// src/contracts/gamepadChannels.ts
//
// Typed pub/sub channels for gamepad intents. The gamepad polling module
// publishes high-level intents here; subscribers (editor navigation,
// manual control bridge) react to them without the gamepad module
// needing to know about menus, themes, or editor internals.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

// ── Intent payloads ─────────────────────────────────────────────

/** Evaluate the current editor content (Start button). */
export interface EvalIntent {}

/** Delete the node at the cursor (Y button). */
export interface DeleteNodeIntent {}

/** Number adjustment at cursor (LB / RB bumpers). */
export interface AdjustNumberIntent {
  delta: number;
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

// ── Channels ────────────────────────────────────────────────────

/** Evaluate editor content. */
export const evalNow: TypedChannel<EvalIntent> = createChannel();

/** Delete node at cursor. */
export const deleteNode: TypedChannel<DeleteNodeIntent> = createChannel();

/** Adjust number at cursor. */
export const adjustNumber: TypedChannel<AdjustNumberIntent> = createChannel();

/** Toggle manual control. */
export const toggleManualControl: TypedChannel<ToggleManualControlIntent> = createChannel();

/** Stick axis update for manual control. */
export const stickAxis: TypedChannel<StickAxisUpdate> = createChannel();

// ── Re-export ───────────────────────────────────────────────────

export type { TypedChannel };
