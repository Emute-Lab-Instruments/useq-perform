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
 * Sanctioned alias for {@link UseqDiagnostic}. Used across the live
 * runtime/worker port path (runtimePorts, worker protocol, transport service).
 * Both names refer to the same diagnostic shape; prefer `UseqDiagnostic` in
 * new interpreter-facing code and `RuntimeDiagnostic` in runtime/port code.
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

// ── State snapshot types (state-sync.md) ─────────────────────

export interface StateSnapshotCell {
  type: "number" | "data" | "callable" | "nil";
  value?: number;
  values?: number[];
  source?: string;
}

export interface StateSnapshotOutput {
  source: string;
  health: "idle" | "running" | "fallback" | "error";
  lkgValue: number;
}

export interface StateSnapshotSlot {
  id: string;
  value: number;
}

export interface StateSnapshotLiveSlot {
  id: string;
  value: number;
  min: number;
  max: number;
}

export interface StateSnapshot {
  transport: { playing: boolean; timeOffset: number };
  time: number;
  cells: Record<string, StateSnapshotCell>;
  outputs: Record<string, StateSnapshotOutput>;
  stateSlots: StateSnapshotSlot[];
  liveSlots: StateSnapshotLiveSlot[];
}

export interface RuntimeDiagnosticsSnapshot {
  startupMode: StartupMode;
  protocolMode: RuntimeProtocolMode;
  settingsSources: RuntimeSettingsSource[];
  activeEnvironment: ActiveEnvironmentSnapshot;
  runtimeSession: RuntimeSessionSnapshot;
  bootstrapFailures: RuntimeBootstrapFailure[];
}
