// src/contracts/editorChannels.ts
//
// Typed pub/sub channels for editor-level structural events.
// These events originate from the editor's structural navigation and mutation
// layer. They are consumed by the radial menu (auto-chain), keyboard hint UI,
// tutorial overlays, and other UI modules.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

// ── Payload types ──────────────────────────────────────────────

/** The type of a structural hole, determining what the radial menu offers. */
export type HoleType =
  | "number"
  | "symbol"
  | "keyword"
  | "string"
  | "expr";

/** Published when the cursor lands on a hole node (post-mutation or post-navigation). */
export interface HoleFocusedDetail {
  /** The hole's declared name (e.g. "freq", "body"). */
  name: string;
  /** The hole's declared type constraint. */
  type: HoleType;
  /** Document offset range of the hole node. */
  from: number;
  to: number;
  /**
   * Whether this focus event originated from a chain (post-mutation auto-advance)
   * vs manual navigation (nav.nextHole / nav.prevHole / d-pad).
   * The radial menu auto-opens only for chain-originated events on typed holes.
   */
  source: "chain" | "navigation";
}

// ── Channels ───────────────────────────────────────────────────

/** Fires when the cursor lands on a hole node. */
export const holeFocused: TypedChannel<HoleFocusedDetail> =
  createChannel<HoleFocusedDetail>();

// ── Re-export ──────────────────────────────────────────────────

export type { TypedChannel };
