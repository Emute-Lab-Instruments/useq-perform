/**
 * Runtime diagnostics — derived computation.
 *
 * getDiagnosticsSnapshot() assembles its result on demand from
 * startupContext + runtimeSessionStore. No separate mutable store.
 *
 * The only genuinely unique state is:
 *   - bootstrapFailures[] (accumulated during bootstrap)
 *   - startupMode + settingsSources (written once during bootstrap, never updated)
 */

import type { RuntimeSessionSnapshot } from "./runtimeSession";
import {
  getEnvironmentCapabilitiesSnapshot,
  getStartupFlagsSnapshot,
} from "./startupContext";
import { getRuntimeSessionState } from "./runtimeSessionStore";
import {
  runtimeDiagnostics as runtimeDiagnosticsChannel,
  bootstrapFailure as bootstrapFailureChannel,
} from "../contracts/runtimeChannels";

export type RuntimeProtocolMode = "legacy" | "json";
export type RuntimeSettingsSource =
  | "defaults"
  | "local-storage"
  | "url-config"
  | "url-code"
  | "nosave";
export type StartupMode =
  | "hardware"
  | "browser-local"
  | "no-module"
  | "unsupported-browser";

export interface ActiveEnvironmentSnapshot {
  areInBrowser: boolean;
  areInDesktopApp: boolean;
  isWebSerialAvailable: boolean;
  isInDevmode: boolean;
  urlParams: Record<string, string>;
}

export interface RuntimeBootstrapFailure {
  scope: string;
  message: string;
}

export interface RuntimeDiagnosticsSnapshot {
  startupMode: StartupMode;
  protocolMode: RuntimeProtocolMode;
  settingsSources: RuntimeSettingsSource[];
  activeEnvironment: ActiveEnvironmentSnapshot;
  runtimeSession: RuntimeSessionSnapshot;
  bootstrapFailures: RuntimeBootstrapFailure[];
}

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

/** @deprecated Use getDiagnosticsSnapshot(). Alias kept for migration. */
export const getRuntimeDiagnostics = getDiagnosticsSnapshot;

// ── Event emission ──────────────────────────────────────────────

/**
 * Derive and publish the current diagnostics snapshot via the typed channel.
 * Replaces the old publishRuntimeDiagnostics() that accepted partial updates.
 */
export function publishDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  const snapshot = getDiagnosticsSnapshot();
  runtimeDiagnosticsChannel.publish(snapshot);
  return snapshot;
}

/**
 * @deprecated Use seedBootstrapDiagnostics() + publishDiagnosticsSnapshot().
 * Thin compatibility shim: accepts partial updates, seeds what it can,
 * then derives and publishes.
 */
export function publishRuntimeDiagnostics(
  updates: Partial<RuntimeDiagnosticsSnapshot>,
): RuntimeDiagnosticsSnapshot {
  if (updates.startupMode !== undefined || updates.settingsSources !== undefined) {
    seedBootstrapDiagnostics({
      startupMode: updates.startupMode ?? bootstrapStartupMode,
      settingsSources: updates.settingsSources ?? bootstrapSettingsSources,
    });
  }
  return publishDiagnosticsSnapshot();
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
