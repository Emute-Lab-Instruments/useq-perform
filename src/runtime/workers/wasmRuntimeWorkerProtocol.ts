/**
 * Wire protocol for the WASM-runtime Web Worker.
 *
 * Discriminated unions of request and response messages exchanged between
 * the main-thread {@link WasmRuntimeWorkerPort} adapter and the worker that
 * hosts the actual WASM interpreter. Every payload here is
 * structured-cloneable so `postMessage()` is sufficient (no transferables
 * are required by the v1 protocol — see the worker readiness rationale in
 * `src/contracts/runtimePorts.ts`).
 *
 * Each request carries a numeric `id`; the matching response/error mirrors
 * that id so the main-side adapter can resolve the correct in-flight
 * promise. Errors come back on a single `error` response type rather than
 * per-method-error variants — the main side throws a real `Error` from the
 * `message` field.
 *
 * Worker URL is supplied at construction time (so different bundles can
 * locate the WASM script), and the worker boots itself on receipt of the
 * first `load` request.
 */
import type { TransportState } from "../../machines/transport.machine";
import type { SharedTransportCommand } from "../../contracts/useqRuntimeContract";
import type {
  LiveSlotMetadata,
  RuntimeDiagnostic,
  TickAndProjectResult,
  TimeSample,
} from "../../contracts/runtimePorts";
import type { StateSnapshot } from "../../contracts/runtimeTypes";

// ─── Request payloads ──────────────────────────────────────────────────────

export interface LoadRequest {
  type: "load";
  id: number;
  /** Absolute URL of the Emscripten-generated bootstrap script. */
  scriptUrl: string;
  /** Whether the host has WASM enabled in user settings. */
  enabled: boolean;
}

export interface EvalCodeRequest {
  type: "evalCode";
  id: number;
  code: string;
  /** Whether the host wants the response to participate in the
   *  `codeEvaluated` channel publish (handled main-side). */
  publish: boolean;
}

export interface UpdateTimeRequest {
  type: "updateTime";
  id: number;
  timeSeconds: number;
}

export interface EvalOutputAtTimeRequest {
  type: "evalOutputAtTime";
  id: number;
  name: string;
  timeSeconds: number;
}

export interface EvalOutputsInTimeWindowRequest {
  type: "evalOutputsInTimeWindow";
  id: number;
  outputs: string[];
  startTime: number;
  endTime: number;
  numSamples: number;
}

export interface TickAndProjectRequest {
  type: "tickAndProject";
  id: number;
  outputs: string[];
  tickTime: number;
  projectionMode: number;
  projectEnd: number;
  numFutureSamples: number;
  projectionOrigin: number;
}

export interface SyncTransportStateRequest {
  type: "syncTransportState";
  id: number;
  state: TransportState;
}

export interface SendTransportCommandRequest {
  type: "sendTransportCommand";
  id: number;
  command: SharedTransportCommand;
}

export interface ReadLastDiagnosticsRequest {
  type: "readLastDiagnostics";
  id: number;
}

export interface ReadActiveDiagnosticsRequest {
  type: "readActiveDiagnostics";
  id: number;
}

export interface SetLiveInputsRequest {
  type: "setLiveInputs";
  id: number;
  values: Record<string, number>;
}

export interface GetLiveSlotsRequest {
  type: "getLiveSlots";
  id: number;
}

export interface ApplyStateSnapshotRequest {
  type: "applyStateSnapshot";
  id: number;
  snapshot: StateSnapshot;
}

export type WasmWorkerRequest =
  | LoadRequest
  | EvalCodeRequest
  | UpdateTimeRequest
  | EvalOutputAtTimeRequest
  | EvalOutputsInTimeWindowRequest
  | TickAndProjectRequest
  | SyncTransportStateRequest
  | SendTransportCommandRequest
  | ReadLastDiagnosticsRequest
  | ReadActiveDiagnosticsRequest
  | SetLiveInputsRequest
  | GetLiveSlotsRequest
  | ApplyStateSnapshotRequest;

// ─── Response payloads ─────────────────────────────────────────────────────

/**
 * Capability snapshot reported by the worker after it has finished
 * instantiating the WASM module. Mirrors `WasmRuntimeCapabilities` minus the
 * `available` field (the main side derives that).
 */
export interface WorkerCapabilitySnapshot {
  enabled: boolean;
  supportsEval: boolean;
  supportsTimeWindow: boolean;
  supportsTickAndProject: boolean;
  supportsLiveInputs: boolean;
}

export interface LoadResponse {
  type: "load-result";
  id: number;
  capabilities: WorkerCapabilitySnapshot;
}

export interface EvalCodeResponse {
  type: "evalCode-result";
  id: number;
  /** `null` only when WASM is disabled main-side at request time. */
  result: string | null;
}

export interface UpdateTimeResponse {
  type: "updateTime-result";
  id: number;
}

export interface EvalOutputAtTimeResponse {
  type: "evalOutputAtTime-result";
  id: number;
  value: number;
}

export interface EvalOutputsInTimeWindowResponse {
  type: "evalOutputsInTimeWindow-result";
  id: number;
  /** Plain `Map` of channel-name → samples. Structured-cloneable. */
  samples: Map<string, TimeSample[]>;
  /** Worker-side capability after this evaluation (time-window may flip
   *  off if the optional export is broken). */
  supportsTimeWindow: boolean;
}

export interface TickAndProjectResponse {
  type: "tickAndProject-result";
  id: number;
  /** `null` when the optional export isn't available — caller falls
   *  back to the legacy 3-call path. */
  result: TickAndProjectResult | null;
  /** Worker-side capability after this call (may flip off on first
   *  failed invocation of a stale binding). */
  supportsTickAndProject: boolean;
}

export interface SyncTransportStateResponse {
  type: "syncTransportState-result";
  id: number;
}

export interface SendTransportCommandResponse {
  type: "sendTransportCommand-result";
  id: number;
}

export interface ReadLastDiagnosticsResponse {
  type: "readLastDiagnostics-result";
  id: number;
  diagnostics: RuntimeDiagnostic[];
}

export interface ReadActiveDiagnosticsResponse {
  type: "readActiveDiagnostics-result";
  id: number;
  diagnostics: RuntimeDiagnostic[];
}

export interface SetLiveInputsResponse {
  type: "setLiveInputs-result";
  id: number;
  applied: number;
}

export interface GetLiveSlotsResponse {
  type: "getLiveSlots-result";
  id: number;
  slots: LiveSlotMetadata[];
}

export interface ApplyStateSnapshotResponse {
  type: "applyStateSnapshot-result";
  id: number;
  success: boolean;
}

export interface ErrorResponse {
  type: "error";
  id: number;
  message: string;
}

export type WasmWorkerResponse =
  | LoadResponse
  | EvalCodeResponse
  | UpdateTimeResponse
  | EvalOutputAtTimeResponse
  | EvalOutputsInTimeWindowResponse
  | TickAndProjectResponse
  | SyncTransportStateResponse
  | SendTransportCommandResponse
  | ReadLastDiagnosticsResponse
  | ReadActiveDiagnosticsResponse
  | SetLiveInputsResponse
  | GetLiveSlotsResponse
  | ApplyStateSnapshotResponse
  | ErrorResponse;
