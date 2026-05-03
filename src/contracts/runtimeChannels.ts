// src/contracts/runtimeChannels.ts
//
// Typed pub/sub channels for runtime events, along with event name constants
// and payload types.  This is the single contract file for all runtime event
// communication.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

import type {
  RuntimeBootstrapFailure,
  RuntimeDiagnosticsSnapshot,
  RuntimeProtocolMode,
  RuntimeSessionSnapshot,
  UseqDiagnostic,
} from "./runtimeTypes";

import type { AppSettings } from "../lib/appSettings";

// ── Event name constants (documentation only) ───────────────────

export const CONNECTION_CHANGED_EVENT = "useq-connection-changed";
export const PROTOCOL_READY_EVENT = "useq-protocol-ready";
export const JSON_META_EVENT = "useq-json-meta";
export const RUNTIME_DIAGNOSTICS_EVENT = "useq-runtime-diagnostics";
export const BOOTSTRAP_FAILURE_EVENT = "useq-bootstrap-failure";
export const CODE_EVALUATED_EVENT = "useq-code-evaluated";
export const ANIMATE_CONNECT_EVENT = "useq-animate-connect";
export const DEVICE_PLUGGED_IN_EVENT = "useq-device-plugged-in";
export const DRIFT_DETECTED_EVENT = "useq-drift-detected";
export const LIVE_EDIT_VALUE_CHANGED_EVENT = "useq-live-edit-value-changed";

// ── Payload types ───────────────────────────────────────────────

export interface ConnectionChangedDetail extends RuntimeSessionSnapshot {
  connected: boolean;
  protocolMode: RuntimeProtocolMode;
}

export interface ProtocolReadyDetail {
  protocolMode: RuntimeProtocolMode;
}

export interface JsonMetaResponse {
  meta?: {
    transport?: string;
    [key: string]: unknown;
  };
  fw?: string;
  success?: boolean;
  type?: string;
  mode?: string;
}

export interface JsonMetaEventDetail {
  response?: JsonMetaResponse;
}

export interface CodeEvaluatedDetail {
  code: string;
}

export type AnimateConnectDetail = undefined;
export type DevicePluggedInDetail = undefined;

/** Payload when WASM↔hardware output drift exceeds the sync threshold. */
export interface DriftDetectedDetail {
  /** Per-output drift scores (0 = perfect match, 1 = total divergence). */
  perOutput: Record<string, number>;
  /** Aggregate drift score across all compared outputs. */
  aggregate: number;
}

/** Payload when a live-edit slot value changes (used for projection invalidation). */
export interface LiveEditValueChangedDetail {
  slotId: string;
  newValue: number;
  oldValue: number;
}

/** Payload for standalone diagnostics frames (spec §5.9). */
export interface StandaloneDiagnosticsDetail {
  diagnostics: UseqDiagnostic[];
}

// ── Detail map (kept for type-level reference) ──────────────────

export interface RuntimeEventDetailMap {
  [CONNECTION_CHANGED_EVENT]: ConnectionChangedDetail;
  [PROTOCOL_READY_EVENT]: ProtocolReadyDetail;
  [JSON_META_EVENT]: JsonMetaEventDetail;
  [RUNTIME_DIAGNOSTICS_EVENT]: RuntimeDiagnosticsSnapshot;
  [BOOTSTRAP_FAILURE_EVENT]: RuntimeBootstrapFailure;
  [CODE_EVALUATED_EVENT]: CodeEvaluatedDetail;
  [ANIMATE_CONNECT_EVENT]: AnimateConnectDetail;
  [DEVICE_PLUGGED_IN_EVENT]: DevicePluggedInDetail;
  [DRIFT_DETECTED_EVENT]: DriftDetectedDetail;
  [LIVE_EDIT_VALUE_CHANGED_EVENT]: LiveEditValueChangedDetail;
}

export type RuntimeEventName = keyof RuntimeEventDetailMap;

export const RUNTIME_EVENT_NAMES = Object.freeze([
  CONNECTION_CHANGED_EVENT,
  PROTOCOL_READY_EVENT,
  JSON_META_EVENT,
  RUNTIME_DIAGNOSTICS_EVENT,
  BOOTSTRAP_FAILURE_EVENT,
  CODE_EVALUATED_EVENT,
  ANIMATE_CONNECT_EVENT,
  DEVICE_PLUGGED_IN_EVENT,
  DRIFT_DETECTED_EVENT,
  LIVE_EDIT_VALUE_CHANGED_EVENT,
] as const satisfies readonly RuntimeEventName[]);

// ── Contract assertion ──────────────────────────────────────────

export function assertRuntimeEventContract(): void {
  if (new Set(RUNTIME_EVENT_NAMES).size !== RUNTIME_EVENT_NAMES.length) {
    throw new Error("Runtime event names must be unique");
  }
}

assertRuntimeEventContract();

// ── Channels ────────────────────────────────────────────────────

/** Transport connection state changed (connected / disconnected / mode change). */
export const connectionChanged = createChannel<ConnectionChangedDetail>();

/** Protocol negotiation completed (JSON or legacy). */
export const protocolReady = createChannel<ProtocolReadyDetail>();

/** JSON meta response received from firmware. */
export const jsonMeta = createChannel<JsonMetaEventDetail>();

/** Runtime diagnostics snapshot updated. */
export const runtimeDiagnostics = createChannel<RuntimeDiagnosticsSnapshot>();

/** A bootstrap failure was recorded. */
export const bootstrapFailure = createChannel<RuntimeBootstrapFailure>();

/** Code was evaluated (WASM or hardware). */
export const codeEvaluated = createChannel<CodeEvaluatedDetail>();

/** UI should animate the connect button (e.g. device not connected yet). */
export const animateConnect = createChannel<AnimateConnectDetail>();

/** A previously-saved serial device was physically plugged in. */
export const devicePluggedIn = createChannel<DevicePluggedInDetail>();

/** WASM↔hardware output drift detected (published by drift detector). */
export const driftDetected = createChannel<DriftDetectedDetail>();

/** Live-edit slot value changed beyond epsilon (published by live-edit runtime). */
export const liveEditValueChanged = createChannel<LiveEditValueChangedDetail>();

/** App settings changed (published by runtimeService after any mutation). */
export const settingsChanged = createChannel<AppSettings>();

/** Standalone diagnostics frame received from firmware (spec §5.9). */
export const standaloneDiagnostics = createChannel<StandaloneDiagnosticsDetail>();

// ── Re-export the channel type for convenience ──────────────────

export type { TypedChannel };
