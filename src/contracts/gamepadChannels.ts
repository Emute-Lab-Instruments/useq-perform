// src/contracts/gamepadChannels.ts
//
// Typed pub/sub channel for the continuous gamepad axis stream. Discrete
// actions route through the source-aware action executor instead of a second
// channel path.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

// ── Intent payloads ─────────────────────────────────────────────

/** Stick axis values for manual control updates. */
export interface StickAxisUpdate {
  stick: "left" | "right";
  x: number;
  y: number;
}

// ── Channels ────────────────────────────────────────────────────

/** Stick axis update for manual control. */
export const stickAxis: TypedChannel<StickAxisUpdate> = createChannel();

// ── Re-export ───────────────────────────────────────────────────

export type { TypedChannel };
