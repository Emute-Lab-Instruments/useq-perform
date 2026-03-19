// src/contracts/runtimeEvents.ts
//
// Type definitions and event name constants for runtime events.
// The CustomEvent dispatch/listen infrastructure has been removed.
// Runtime events are now communicated through typed channels in
// src/contracts/runtimeChannels.ts.
//
// Event name constants are retained for documentation and test references.

import type {
  RuntimeBootstrapFailure,
  RuntimeDiagnosticsSnapshot,
  RuntimeProtocolMode,
} from "../runtime/runtimeDiagnostics";
import type { RuntimeSessionSnapshot } from "../runtime/runtimeSession";

// ── Event name constants (documentation only) ───────────────────

export const CONNECTION_CHANGED_EVENT = "useq-connection-changed";
export const PROTOCOL_READY_EVENT = "useq-protocol-ready";
export const JSON_META_EVENT = "useq-json-meta";
export const RUNTIME_DIAGNOSTICS_EVENT = "useq-runtime-diagnostics";
export const BOOTSTRAP_FAILURE_EVENT = "useq-bootstrap-failure";
export const CODE_EVALUATED_EVENT = "useq-code-evaluated";
export const ANIMATE_CONNECT_EVENT = "useq-animate-connect";
export const DEVICE_PLUGGED_IN_EVENT = "useq-device-plugged-in";

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
] as const satisfies readonly RuntimeEventName[]);

// ── Contract assertion ──────────────────────────────────────────

export function assertRuntimeEventContract(): void {
  if (new Set(RUNTIME_EVENT_NAMES).size !== RUNTIME_EVENT_NAMES.length) {
    throw new Error("Runtime event names must be unique");
  }
}

assertRuntimeEventContract();
