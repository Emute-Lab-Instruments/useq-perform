// src/effects/transportClock.ts
//
// Mock-time policy: decides when the mock time generator should run based on
// transport state transitions and runtime session state.  Extracted from
// TransportToolbar so the policy is testable without mounting a UI component.

import type { TransportState } from "../machines/transport.machine";
import {
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
} from "../runtime/runtimeService";
import {
  startMockTimeGenerator,
  stopMockTimeGenerator,
  resumeMockTimeGenerator,
  resetMockTimeGenerator,
} from "./mockTimeGenerator";

// ── Pure policy ─────────────────────────────────────────────────

/**
 * Determine whether the mock time generator should drive visualisations.
 * True when not connected to real hardware but WASM is enabled.
 */
export function shouldUseMockTime(): boolean {
  const s = getRuntimeServiceSnapshot();
  return !s.session.hasHardwareConnection && s.session.wasmEnabled;
}

/**
 * Apply mock-time side effects for a transport state transition.
 * Call this every time the transport machine changes state.
 */
export function applyMockTimePolicy(
  current: TransportState,
  previous: TransportState
): void {
  if (!shouldUseMockTime()) return;

  if (current === "playing") {
    if (previous === "paused") {
      resumeMockTimeGenerator();
    } else {
      startMockTimeGenerator();
    }
  } else if (current === "paused") {
    stopMockTimeGenerator();
  } else if (current === "stopped") {
    stopMockTimeGenerator();
    resetMockTimeGenerator();
  }
}

// ── Runtime-connection listener ─────────────────────────────────

/**
 * Start listening for runtime session changes that invalidate mock time.
 * When hardware connects, mock time is unconditionally stopped.
 *
 * Returns an unsubscribe function.
 */
export function listenForHardwareOverride(): () => void {
  return subscribeRuntimeService((runtimeState) => {
    if (runtimeState.connected && runtimeState.session.hasHardwareConnection) {
      stopMockTimeGenerator();
    }
  });
}
