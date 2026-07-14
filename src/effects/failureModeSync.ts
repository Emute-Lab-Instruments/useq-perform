/**
 * Failure-mode sync effect (failure-model.md §3.2, settings.md).
 *
 * Keeps BOTH runtimes' non-finite failure policy in step with the
 * `runtime.failureMode` setting ("lkg" default / "zero" legacy):
 *
 * - WASM: `setWasmFailureModeSync` → `useq_set_failure_mode` (the interpreter
 *   also applies the setting itself at init, so a late WASM load is covered).
 * - Hardware: `sendSetFailureMode` → wire `set-failure-mode` (§5.18). The
 *   device does not persist the mode; the on-connect re-send lives in the
 *   JSON-protocol handshake (`completeHandshake`), this effect only covers
 *   changes made while already connected.
 *
 * Subscribes to the `settingsChanged` channel and pushes only when the value
 * actually changed, so unrelated settings mutations don't spam the wire.
 */
import { settingsChanged } from "../contracts/runtimeChannels.ts";
import { setWasmFailureModeSync } from "../runtime/wasmRuntimePort.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { sendSetFailureMode, isJsonProtocolActive } from "../transport/index.ts";
import { dbg } from "../lib/debug.ts";
import type { FailureMode } from "../lib/settings/schema.ts";

let unsubscribe: (() => void) | null = null;
let lastPushedMode: FailureMode | null = null;

function pushMode(mode: FailureMode): void {
  setWasmFailureModeSync(mode);
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
