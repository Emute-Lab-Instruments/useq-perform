import type { RuntimeSessionSnapshot } from "./runtimeSession";
import {
  BOOTSTRAP_FAILURE_EVENT,
  dispatchRuntimeEvent,
  RUNTIME_DIAGNOSTICS_EVENT,
} from "../contracts/runtimeEvents";
import { resolveBootstrapPlan } from "./bootstrapPlan";

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

const DEFAULT_ENVIRONMENT: ActiveEnvironmentSnapshot = {
  areInBrowser: false,
  areInDesktopApp: false,
  isWebSerialAvailable: false,
  isInDevmode: false,
  urlParams: {},
};

const DEFAULT_RUNTIME_SESSION: RuntimeSessionSnapshot = {
  hasHardwareConnection: false,
  noModuleMode: false,
  wasmEnabled: true,
  connectionMode: "none",
  transportMode: "none",
};

const DEFAULT_DIAGNOSTICS: RuntimeDiagnosticsSnapshot = {
  startupMode: "browser-local",
  protocolMode: "legacy",
  settingsSources: ["defaults"],
  activeEnvironment: DEFAULT_ENVIRONMENT,
  runtimeSession: DEFAULT_RUNTIME_SESSION,
  bootstrapFailures: [],
};

let currentDiagnostics: RuntimeDiagnosticsSnapshot = {
  ...DEFAULT_DIAGNOSTICS,
  settingsSources: [...DEFAULT_DIAGNOSTICS.settingsSources],
  activeEnvironment: { ...DEFAULT_DIAGNOSTICS.activeEnvironment },
  runtimeSession: { ...DEFAULT_DIAGNOSTICS.runtimeSession },
  bootstrapFailures: [],
};

function emitDiagnosticsEvent(
  name: typeof RUNTIME_DIAGNOSTICS_EVENT | typeof BOOTSTRAP_FAILURE_EVENT,
  detail: RuntimeDiagnosticsSnapshot | RuntimeBootstrapFailure
): void {
  dispatchRuntimeEvent(name, detail as never);
}

export function resolveStartupMode(input: {
  areInBrowser: boolean;
  isWebSerialAvailable: boolean;
  noModuleMode: boolean;
  startLocallyWithoutHardware?: boolean;
  wasmEnabled?: boolean;
}): StartupMode {
  if (!input.areInBrowser) {
    return "browser-local";
  }

  return resolveBootstrapPlan({
    noModuleMode: input.noModuleMode,
    isWebSerialAvailable: input.isWebSerialAvailable,
    wasmEnabled: input.wasmEnabled ?? true,
    startLocallyWithoutHardware: input.startLocallyWithoutHardware ?? true,
  }).startupMode;
}

export function getRuntimeDiagnostics(): RuntimeDiagnosticsSnapshot {
  return {
    ...currentDiagnostics,
    settingsSources: [...currentDiagnostics.settingsSources],
    activeEnvironment: { ...currentDiagnostics.activeEnvironment },
    runtimeSession: { ...currentDiagnostics.runtimeSession },
    bootstrapFailures: [...currentDiagnostics.bootstrapFailures],
  };
}

export function publishRuntimeDiagnostics(
  updates: Partial<RuntimeDiagnosticsSnapshot>
): RuntimeDiagnosticsSnapshot {
  currentDiagnostics = {
    ...currentDiagnostics,
    ...updates,
    settingsSources: updates.settingsSources
      ? [...updates.settingsSources]
      : [...currentDiagnostics.settingsSources],
    activeEnvironment: updates.activeEnvironment
      ? { ...updates.activeEnvironment }
      : { ...currentDiagnostics.activeEnvironment },
    runtimeSession: updates.runtimeSession
      ? { ...updates.runtimeSession }
      : { ...currentDiagnostics.runtimeSession },
    bootstrapFailures: updates.bootstrapFailures
      ? [...updates.bootstrapFailures]
      : [...currentDiagnostics.bootstrapFailures],
  };

  emitDiagnosticsEvent(RUNTIME_DIAGNOSTICS_EVENT, getRuntimeDiagnostics());
  return getRuntimeDiagnostics();
}

export function reportBootstrapFailure(
  scope: string,
  error: unknown
): RuntimeBootstrapFailure {
  const failure: RuntimeBootstrapFailure = {
    scope,
    message: error instanceof Error ? error.message : String(error),
  };

  currentDiagnostics = {
    ...currentDiagnostics,
    bootstrapFailures: [...currentDiagnostics.bootstrapFailures, failure],
  };

  emitDiagnosticsEvent(BOOTSTRAP_FAILURE_EVENT, failure);
  emitDiagnosticsEvent(RUNTIME_DIAGNOSTICS_EVENT, getRuntimeDiagnostics());
  return failure;
}

export function resetRuntimeDiagnostics(): void {
  currentDiagnostics = {
    ...DEFAULT_DIAGNOSTICS,
    settingsSources: [...DEFAULT_DIAGNOSTICS.settingsSources],
    activeEnvironment: { ...DEFAULT_DIAGNOSTICS.activeEnvironment },
    runtimeSession: { ...DEFAULT_DIAGNOSTICS.runtimeSession },
    bootstrapFailures: [],
  };
}
