import type {
  RuntimeBootstrapFailure,
  RuntimeDiagnosticsSnapshot,
  RuntimeProtocolMode,
} from "../runtime/runtimeDiagnostics";
import type { RuntimeSessionSnapshot } from "../runtime/runtimeSession";

export const CONNECTION_CHANGED_EVENT = "useq-connection-changed";
export const PROTOCOL_READY_EVENT = "useq-protocol-ready";
export const JSON_META_EVENT = "useq-json-meta";
export const RUNTIME_DIAGNOSTICS_EVENT = "useq-runtime-diagnostics";
export const BOOTSTRAP_FAILURE_EVENT = "useq-bootstrap-failure";
export const CODE_EVALUATED_EVENT = "useq-code-evaluated";
export const ANIMATE_CONNECT_EVENT = "useq-animate-connect";
export const DEVICE_PLUGGED_IN_EVENT = "useq-device-plugged-in";

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

function getCustomEventConstructor():
  | (new <T>(type: string, eventInitDict?: CustomEventInit<T>) => CustomEvent<T>)
  | null {
  if (typeof window !== "undefined" && typeof window.CustomEvent === "function") {
    return window.CustomEvent;
  }

  if (typeof globalThis.CustomEvent === "function") {
    return globalThis.CustomEvent;
  }

  return null;
}

export function assertRuntimeEventContract(): void {
  if (new Set(RUNTIME_EVENT_NAMES).size !== RUNTIME_EVENT_NAMES.length) {
    throw new Error("Runtime event names must be unique");
  }
}

export function dispatchRuntimeEvent<Name extends RuntimeEventName>(
  name: Name,
  detail: RuntimeEventDetailMap[Name],
  target:
    | Pick<Window, "dispatchEvent">
    | undefined = typeof window !== "undefined" ? window : undefined
): boolean {
  if (!target || typeof target.dispatchEvent !== "function") {
    return false;
  }

  const EventCtor = getCustomEventConstructor();
  if (!EventCtor) {
    return false;
  }

  return target.dispatchEvent(new EventCtor(name, { detail }));
}

export function readRuntimeEventDetail<Name extends RuntimeEventName>(
  event: Event
): RuntimeEventDetailMap[Name] {
  return (event as CustomEvent<RuntimeEventDetailMap[Name]>).detail;
}

export function addRuntimeEventListener<Name extends RuntimeEventName>(
  name: Name,
  listener: (
    detail: RuntimeEventDetailMap[Name],
    event: CustomEvent<RuntimeEventDetailMap[Name]>
  ) => void,
  target:
    | Pick<Window, "addEventListener" | "removeEventListener">
    | undefined = typeof window !== "undefined" ? window : undefined
): () => void {
  if (!target) {
    return () => undefined;
  }

  const wrapped = (event: Event): void => {
    listener(
      readRuntimeEventDetail<Name>(event),
      event as CustomEvent<RuntimeEventDetailMap[Name]>
    );
  };

  target.addEventListener(name, wrapped as EventListener);
  return () => {
    target.removeEventListener(name, wrapped as EventListener);
  };
}

assertRuntimeEventContract();
