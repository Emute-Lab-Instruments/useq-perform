// src/effects/transportClock.ts
//
// Clock policy: decides when the local clock should run based on transport
// state transitions and runtime session state. When hardware is connected,
// the serial stream provides time; otherwise the local clock does.

import type { TransportState } from "../machines/transport.machine";
import {
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
} from "../runtime/runtimeService";
import {
  startLocalClock,
  stopLocalClock,
  resumeLocalClock,
  resetLocalClock,
} from "./localClock";

// ── Pure policy ─────────────────────────────────────────────────

/**
 * Whether the local clock should drive visualisations.
 * True when not connected to real hardware but WASM is enabled.
 */
export function shouldUseLocalClock(): boolean {
  const s = getRuntimeServiceSnapshot();
  return !s.session.hasHardwareConnection && s.session.wasmEnabled;
}

// Backward-compatible alias
export { shouldUseLocalClock as shouldUseMockTime };

/**
 * Apply clock policy for a transport state transition.
 * Call this every time the transport machine changes state.
 */
export function applyClockPolicy(
  current: TransportState,
  previous: TransportState
): void {
  if (!shouldUseLocalClock()) return;

  if (current === "playing") {
    if (previous === "paused") {
      resumeLocalClock();
    } else {
      startLocalClock();
    }
  } else if (current === "paused") {
    stopLocalClock();
  } else if (current === "stopped") {
    stopLocalClock();
    resetLocalClock();
  }
}

// Backward-compatible alias
export { applyClockPolicy as applyMockTimePolicy };

// ── Runtime-connection listener ─────────────────────────────────

/**
 * Start listening for runtime session changes that invalidate the local clock.
 * When hardware connects, the local clock is unconditionally stopped.
 *
 * Returns an unsubscribe function.
 */
export function listenForHardwareOverride(): () => void {
  return subscribeRuntimeService((runtimeState) => {
    if (runtimeState.connected && runtimeState.session.hasHardwareConnection) {
      stopLocalClock();
    }
  });
}
