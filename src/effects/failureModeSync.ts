/**
 * Failure-mode sync effect (failure-model.md §3.2, settings.md).
 *
 * Keeps BOTH runtimes' non-finite failure policy in step with the
 * `runtime.failureMode` setting ("lkg" default / "zero" legacy):
 *
 * - WASM: the active Worker port forwards to `useq_set_failure_mode`.
 * - Hardware: `sendSetFailureMode` → wire `set-failure-mode` (§5.18). The
 *   device does not persist the mode; the on-connect re-send lives in the
 *   JSON-protocol handshake (`completeHandshake`), this effect only covers
 *   changes made while already connected.
 *
 * Subscribes to the `settingsChanged` channel and pushes only when the value
 * actually changed, so unrelated settings mutations don't spam the wire.
 */
import { settingsChanged } from "../contracts/runtimeChannels.ts";
import { getActiveWasmRuntimePort, hasActiveWasmRuntimePort } from "../runtime/runtimeCoordinator.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { sendSetFailureMode, isJsonProtocolActive } from "../transport/index.ts";
import { dbg } from "../lib/debug.ts";
import type { FailureMode } from "../lib/settings/schema.ts";

let unsubscribe: (() => void) | null = null;
let lastPushedMode: FailureMode | null = null;

function pushWasmMode(mode: FailureMode): void {
  if (hasActiveWasmRuntimePort()) {
    getActiveWasmRuntimePort().setFailureMode(mode).catch((error: Error) => {
      dbg(`failureModeSync: WASM set-failure-mode failed: ${error.message}`);
    });
  }
}

function pushMode(mode: FailureMode): void {
  pushWasmMode(mode);
  if (isJsonProtocolActive()) {
    sendSetFailureMode(mode).catch((error: Error) => {
      dbg(`failureModeSync: hardware set-failure-mode failed: ${error.message}`);
    });
  }
}

/**
 * Start syncing `runtime.failureMode` to the active runtimes.
 * Idempotent — calling twice is a no-op.
 */
export function initFailureModeSync(): void {
  if (unsubscribe) return;
  lastPushedMode = getAppSettings()?.runtime?.failureMode ?? "lkg";
  pushWasmMode(lastPushedMode);
  unsubscribe = settingsChanged.subscribe((settings) => {
    const mode = settings.runtime?.failureMode ?? "lkg";
    if (mode === lastPushedMode) return;
    lastPushedMode = mode;
    pushMode(mode);
  });
}

/** Tear down the subscription (used by tests / app shutdown). */
export function teardownFailureModeSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  lastPushedMode = null;
}
