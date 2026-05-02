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

// ── Interpreter diagnostic type ───────────────────────────────
//
// Canonical type for structured diagnostics from the ModuLisp interpreter
// (errors, warnings, hints with source spans). Both the WASM and hardware
// paths produce this shape; the hardware path will emit the same JSON once
// the firmware ships it.

export interface UseqDiagnostic {
  start: number;
  end: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  suggestion?: string;
  example?: string;
}

/**
 * @deprecated Use {@link UseqDiagnostic} instead. This alias exists only for
 * migration convenience and will be removed in a future release.
 */
export type RuntimeDiagnostic = UseqDiagnostic;

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
