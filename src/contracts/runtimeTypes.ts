// src/contracts/runtimeTypes.ts
//
// Shared type definitions for runtime session and diagnostics.
// These types live in contracts/ so that both contracts/ and runtime/
// can import them without creating upward dependency violations.

// ── Session types ──────────────────────────────────────────────

export type RuntimeConnectionMode = "hardware" | "browser" | "none";
export type TransportMode = "hardware" | "wasm" | "both" | "none";

export interface RuntimeSessionInputs {
  hasHardwareConnection: boolean;
  noModuleMode: boolean;
  wasmEnabled: boolean;
}

export interface RuntimeSessionSnapshot extends RuntimeSessionInputs {
  connectionMode: RuntimeConnectionMode;
  transportMode: TransportMode;
}

// ── Diagnostics types ──────────────────────────────────────────

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
