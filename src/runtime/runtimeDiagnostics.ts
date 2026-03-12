import type { RuntimeSessionSnapshot } from "./runtimeSession";

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
  name: "useq-runtime-diagnostics" | "useq-bootstrap-failure",
  detail: RuntimeDiagnosticsSnapshot | RuntimeBootstrapFailure
): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  const EventCtor = window.CustomEvent ?? globalThis.CustomEvent;
  if (typeof EventCtor !== "function") {
    return;
  }

  window.dispatchEvent(new EventCtor(name, { detail }));
}

export function resolveStartupMode(input: {
  areInBrowser: boolean;
  isWebSerialAvailable: boolean;
  noModuleMode: boolean;
  startLocallyWithoutHardware?: boolean;
}): StartupMode {
  if (input.noModuleMode) {
    return "no-module";
  }

  if (
    !input.areInBrowser ||
    !input.isWebSerialAvailable ||
    input.startLocallyWithoutHardware
  ) {
    return "browser-local";
  }

  return "hardware";
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

  emitDiagnosticsEvent("useq-runtime-diagnostics", getRuntimeDiagnostics());
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

  emitDiagnosticsEvent("useq-bootstrap-failure", failure);
  emitDiagnosticsEvent("useq-runtime-diagnostics", getRuntimeDiagnostics());
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
