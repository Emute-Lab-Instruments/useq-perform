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
import { visualisationSession } from "./visualisationSession.ts";

/** Start the internal clock from zero. */
export function startInternalClock(): boolean {
  if (visualisationSession.clock.isLocal()) return false;
  visualisationSession.clock.reset();
  visualisationSession.clock.startRuntime();
  visualisationSession.clock.setLocal(true);
  return true;
}

function stopInternalClock(): boolean {
  if (!visualisationSession.clock.isLocal()) return false;
  visualisationSession.clock.setLocal(false);
  return true;
}

function resumeInternalClock(): boolean {
  if (visualisationSession.clock.isLocal()) return false;
  visualisationSession.clock.startRuntime();
  visualisationSession.clock.setLocal(true);
  return true;
}

function resetInternalClock(): void {
  const wasRunning = visualisationSession.clock.isLocal();
  visualisationSession.clock.setLocal(false);
  visualisationSession.clock.reset();
  if (wasRunning) visualisationSession.clock.setLocal(true);
}

// ── Pure policy ─────────────────────────────────────────────────

/**
 * Whether the local clock should drive visualisations.
 * True when not connected to real hardware but WASM is enabled.
 */
export function shouldUseLocalClock(): boolean {
  const s = getRuntimeServiceSnapshot();
  return !s.session.hasHardwareConnection && s.session.wasmEnabled;
}

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
      resumeInternalClock();
    } else {
      startInternalClock();
    }
  } else if (current === "paused") {
    stopInternalClock();
  } else if (current === "stopped") {
    stopInternalClock();
    resetInternalClock();
  }
}

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
      stopInternalClock();
    }
  });
}
