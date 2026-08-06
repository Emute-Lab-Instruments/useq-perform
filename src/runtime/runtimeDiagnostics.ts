/**
 * Runtime diagnostics — derived computation.
 *
 * getDiagnosticsSnapshot() assembles its result on demand from
 * startupContext + runtimeCoordinator. No separate mutable store.
 *
 * The only genuinely unique state is:
 *   - bootstrapFailures[] (accumulated during bootstrap)
 *   - startupMode + settingsSources (written once during bootstrap, never updated)
 */

// Re-export types from contracts (canonical location)
export type {
  RuntimeProtocolMode,
  RuntimeSettingsSource,
  StartupMode,
  ActiveEnvironmentSnapshot,
  RuntimeBootstrapFailure,
  RuntimeDiagnosticsSnapshot,
} from "../contracts/runtimeTypes";

import type {
  RuntimeProtocolMode,
  RuntimeSettingsSource,
  StartupMode,
  RuntimeBootstrapFailure,
  RuntimeDiagnosticsSnapshot,
} from "../contracts/runtimeTypes";
import type { RuntimeSessionSnapshot } from "../contracts/runtimeTypes";
import {
  getEnvironmentCapabilitiesSnapshot,
  getStartupFlagsSnapshot,
} from "./startupContext";
import { getRuntimeSessionState } from "./runtimeCoordinator";
import {
  runtimeDiagnostics as runtimeDiagnosticsChannel,
  bootstrapFailure as bootstrapFailureChannel,
} from "../contracts/runtimeChannels";

// ── Bootstrap-only state (written once, read many) ──────────────

let bootstrapStartupMode: StartupMode = "browser-local";
let bootstrapSettingsSources: RuntimeSettingsSource[] = ["defaults"];
const bootstrapFailures: RuntimeBootstrapFailure[] = [];

// ── Public: one-time bootstrap seeding ──────────────────────────

/**
 * Called once during bootstrap to record the startup mode and settings sources.
 * These values never change after bootstrap.
 */
export function seedBootstrapDiagnostics(seed: {
  startupMode: StartupMode;
  settingsSources: RuntimeSettingsSource[];
}): void {
  bootstrapStartupMode = seed.startupMode;
  bootstrapSettingsSources = [...seed.settingsSources];
}

// ── Derived snapshot ────────────────────────────────────────────

/**
 * Pure derivation: assembles a diagnostics snapshot from canonical
 * state sources on every call. No mutable diagnostics store.
 */
export function getDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  const caps = getEnvironmentCapabilitiesSnapshot();
  const flags = getStartupFlagsSnapshot();
  const sessionState = getRuntimeSessionState();

  return {
    startupMode: bootstrapStartupMode,
    protocolMode: sessionState.protocolMode,
    settingsSources: [...bootstrapSettingsSources],
    activeEnvironment: {
      areInBrowser: caps.areInBrowser,
      areInDesktopApp: caps.areInDesktopApp,
      isWebSerialAvailable: caps.isWebSerialAvailable,
      isInDevmode: flags.devmode,
      urlParams: { ...flags.params },
    },
    runtimeSession: { ...sessionState.session },
    bootstrapFailures: [...bootstrapFailures],
  };
}

// ── Event emission ──────────────────────────────────────────────

/**
 * Derive and publish the current diagnostics snapshot via the typed channel.
 * Bootstrap-only fields are seeded via seedBootstrapDiagnostics(); everything
 * else is derived from canonical state on each call.
 */
export function publishDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  const snapshot = getDiagnosticsSnapshot();
  runtimeDiagnosticsChannel.publish(snapshot);
  return snapshot;
}

// ── Bootstrap failure tracking ──────────────────────────────────

export function reportBootstrapFailure(
  scope: string,
  error: unknown,
): RuntimeBootstrapFailure {
  const failure: RuntimeBootstrapFailure = {
    scope,
    message: error instanceof Error ? error.message : String(error),
  };

  bootstrapFailures.push(failure);

  bootstrapFailureChannel.publish(failure);
  runtimeDiagnosticsChannel.publish(getDiagnosticsSnapshot());
  return failure;
}

// ── Test support ────────────────────────────────────────────────

export function resetRuntimeDiagnostics(): void {
  bootstrapStartupMode = "browser-local";
  bootstrapSettingsSources = ["defaults"];
  bootstrapFailures.length = 0;
}
