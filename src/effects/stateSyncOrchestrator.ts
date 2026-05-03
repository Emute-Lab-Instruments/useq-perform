/**
 * State Sync Orchestrator — drives the snapshot request → apply cycle
 * when the drift detector fires.
 *
 * Subscribes to the `driftDetected` channel and, when a drift event
 * arrives, requests a state snapshot from the hardware port and applies
 * it to the WASM port. Manages cooldown, in-flight state, and user-
 * visible feedback via the console store.
 *
 * @see docs/specs/state-sync.md
 */

import {
  driftDetected as driftDetectedChannel,
  connectionChanged as connectionChangedChannel,
} from "../contracts/runtimeChannels";
import type { DriftDetectedDetail } from "../contracts/runtimeChannels";
import type { WebSerialHostPort, WasmRuntimePort } from "../contracts/runtimePorts";
import { post } from "../utils/consoleStore";
import { dbg } from "../lib/debug";
import {
  enableDriftDetection,
  disableDriftDetection,
  resetDriftScores,
  startEvalCooldownListener,
  stopEvalCooldownListener,
} from "./driftDetector";
import { invalidateFutureProjections } from "./visualisationSampler";

// ── State ───────────────────────────────────────────────────────────

let syncing = false;
let syncCount = 0;
let driftUnsubscribe: (() => void) | null = null;
let connectionUnsubscribe: (() => void) | null = null;

let hwPort: WebSerialHostPort | null = null;
let wasmPort: WasmRuntimePort | null = null;

// ── Core sync cycle ─────────────────────────────────────────────────

async function handleDriftDetected(detail: DriftDetectedDetail): Promise<void> {
  if (syncing) return;
  if (!hwPort || !wasmPort) return;

  const driftedOutputs = Object.entries(detail.perOutput)
    .filter(([, score]) => score > 0.01)
    .map(([name]) => name);

  if (driftedOutputs.length === 0) return;

  syncing = true;
  syncCount += 1;
  const syncId = syncCount;

  dbg(`stateSync[${syncId}]: drift detected on ${driftedOutputs.join(", ")} (aggregate=${detail.aggregate.toFixed(4)})`);
  post(`WASM state drifted from hardware on ${driftedOutputs.join(", ")} — resyncing…`, "warn");

  try {
    const snapshot = await hwPort.requestStateSnapshot();
    if (!snapshot) {
      dbg(`stateSync[${syncId}]: hardware did not return a state snapshot (firmware may not support get-state)`);
      post("State resync skipped — firmware does not support state snapshots yet.", "warn");
      return;
    }

    dbg(`stateSync[${syncId}]: received snapshot — ${Object.keys(snapshot.cells || {}).length} cells, ${Object.keys(snapshot.outputs || {}).length} outputs, ${(snapshot.stateSlots || []).length} state slots`);

    const applied = await wasmPort.applyStateSnapshot(snapshot);
    if (applied) {
      dbg(`stateSync[${syncId}]: snapshot applied successfully`);
      post("WASM state resynced with hardware.");
      invalidateFutureProjections();
    } else {
      dbg(`stateSync[${syncId}]: snapshot apply failed (WASM export may be unavailable)`);
      post("State resync failed — WASM apply_state_snapshot not available.", "warn");
    }
  } catch (error) {
    dbg(`stateSync[${syncId}]: error during resync: ${error}`);
  } finally {
    resetDriftScores();
    syncing = false;
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function initStateSyncOrchestrator(
  hardwarePort: WebSerialHostPort,
  wasmRuntimePort: WasmRuntimePort,
): void {
  hwPort = hardwarePort;
  wasmPort = wasmRuntimePort;

  driftUnsubscribe = driftDetectedChannel.subscribe((detail) => {
    void handleDriftDetected(detail);
  });

  connectionUnsubscribe = connectionChangedChannel.subscribe((detail) => {
    if (detail.transportMode === "both") {
      enableDriftDetection();
      startEvalCooldownListener();
    } else {
      disableDriftDetection();
      stopEvalCooldownListener();
    }
  });
}

export function teardownStateSyncOrchestrator(): void {
  driftUnsubscribe?.();
  driftUnsubscribe = null;
  connectionUnsubscribe?.();
  connectionUnsubscribe = null;
  disableDriftDetection();
  stopEvalCooldownListener();
  hwPort = null;
  wasmPort = null;
  syncing = false;
}

export function isStateSyncInProgress(): boolean {
  return syncing;
}

export function getStateSyncCount(): number {
  return syncCount;
}
