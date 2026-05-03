// src/contracts/hardwareChannels.ts
//
// Typed pub/sub channels for hardware input events from the device.
// The serial protocol parser publishes to these channels when it receives
// an `hw-input` push message (wire-protocol.md §5.10).
//
// Consumers: binding dispatch (Phase 5.3), binding-chip pulse animation,
// test-fire simulation, diagnostics.

import { createChannel, type TypedChannel } from "../lib/typedChannel";
import type { HwInputEvent } from "./hardware";

// ── Channels ───────────────────────────────────────────────────

/** Fires when the device pushes a hardware input event (button, toggle, encoder, gate). */
export const hwInput: TypedChannel<HwInputEvent> =
  createChannel<HwInputEvent>();
