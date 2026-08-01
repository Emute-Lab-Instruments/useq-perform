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
  SynthArtifactsPayload,
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

/**
 * Eval + diagnostics in a single round-trip. The worker calls
 * `interpreter.evaluate(code)` and reads `useq_last_diagnostics` in the
 * same handler before returning, so the diagnostics are guaranteed to
 * belong to this eval. Required to avoid the race where two concurrent
 * evals interleave their evalCode/readLastDiagnostics messages on the
 * worker FIFO and pick up each other's diagnostics.
 */
export interface EvalCodeWithDiagnosticsRequest {
  type: "evalCodeWithDiagnostics";
  id: number;
  code: string;
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

export interface SetHwInputValueRequest {
  type: "setHwInputValue";
  id: number;
  index: number;
  value: number;
}

export interface ProbeSetRequest {
  type: "probeSet";
  id: number;
  slot: number;
  code: string;
}

export interface ProbeSampleRequest {
  type: "probeSample";
  id: number;
  slot: number;
  startTime: number;
  endTime: number;
  count: number;
}

export interface ProbeFreeRequest {
  type: "probeFree";
  id: number;
  slot: number;
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

// ─── Producer (audio-clocked future-control) requests ──────────────────────
//
// The producer turns the existing WASM runtime Worker into the audio-clocked
// future-control producer (mission feature `m1-audio-clocked-worker-producer`).
// The main thread installs the SAB, asks the Worker to arm the next program
// epoch, and applies external inputs. The Worker runs the producer scheduler
// between message-handler iterations so the regular Worker inbox stays
// responsive (VAL-ENGINE-006).

/**
 * Install the SharedArrayBuffer that carries the control ring. The Worker
 * attaches a typed {@link SynthesisControlView} and stores it for the
 * producer scheduler. The buffer is transferred (not copied) so both sides
 * share storage.
 */
export interface ProducerInstallSabRequest {
  type: "producerInstallSab";
  id: number;
  /** The shared buffer carrying the synthesis control ABI. */
  controlBuffer: SharedArrayBuffer;
  /** Block-rate channel names in declared order. */
  blockRateChannels: readonly string[];
  /** Lookahead in blocks (default taken from the SAB header when omitted). */
  lookaheadBlocks?: number;
  /** Render quantum in frames per block (default 128). */
  renderQuantumFrames?: number;
}

/**
 * Start the producer. The producer loop runs between Worker message-handler
 * iterations; each iteration publishes enough blocks to refill the ring up
 * to the configured lookahead.
 *
 * VAL-ENGINE-001: starting the producer does NOT create a second
 * interpreter. The producer drives the existing {@link InterpreterHandle}.
 */
export interface ProducerStartRequest {
  type: "producerStart";
  id: number;
  /** Anchor frame to start transport at (defaults to current audio frame). */
  anchorFrame?: bigint;
  /** Anchor ModuLisp time (defaults to 0). */
  anchorTime?: number;
  /** Sample rate the audio context is running at. */
  sampleRate: number;
  /** Optional lookahead override (defaults to SAB header value). */
  lookaheadBlocks?: number;
  /** Optional render-quantum override (defaults to SAB header value). */
  renderQuantumFrames?: number;
}

/** Stop the producer. Safe to call when the producer is already stopped. */
export interface ProducerStopRequest {
  type: "producerStop";
  id: number;
}

/**
 * Update the static control values the producer publishes on every block.
 * Values are resolved at eval-commit time, not sampled per block from the
 * interpreter's signal graph (VAL-CROSS-002 static-control model).
 *
 * Since M2.2 the channel namespace is per-(node, param): keys are the
 * composite `controlChannelKey(identity, param)` strings and the optional
 * `blockRateChannels` field re-arms the producer's channel list (in
 * commit-plan order, so the producer's array index equals the SAB channel
 * index) in the same message that delivers the values.
 */
export interface ProducerSetControlValuesRequest {
  type: "producerSetControlValues";
  id: number;
  /** Composite channel key (`controlChannelKey`) to numeric value. */
  values: Record<string, number>;
  /**
   * Re-armed per-(node, param) channel list in commit-plan order.
   * Omitted: the producer keeps its current list.
   */
  blockRateChannels?: readonly string[];
}

/** Reserve a control layout/value set for an epoch without publishing it. */
export interface ProducerPrepareCommitRequest {
  type: "producerPrepareCommit";
  id: number;
  epoch: number;
  values: Record<string, number>;
  blockRateChannels: readonly string[];
}

/** Drop a prepared producer candidate. Active controls remain unchanged. */
export interface ProducerAbortCommitRequest {
  type: "producerAbortCommit";
  id: number;
  epoch: number;
}

/**
 * Update transport state on the producer. Drives the pure transport frame
 * map and is deterministic across start, pause, resume, stop, and re-anchor
 * transitions (VAL-ENGINE-003 / VAL-ENGINE-032).
 */
export interface ProducerTransportUpdateRequest {
  type: "producerTransportUpdate";
  id: number;
  /** Transport transition to apply. */
  transition:
    | "start"
    | "pause"
    | "resume"
    | "stop"
    | "reanchor";
  /** Audio frame at which the transition takes effect. */
  atFrame: bigint;
  /** Optional ModuLisp time at the transition frame. */
  atTime?: number;
}

/**
 * Apply external inputs to the next produced block. Inputs never
 * retroactively modify already-published blocks (VAL-ENGINE-005).
 */
export interface ProducerApplyInputsRequest {
  type: "producerApplyInputs";
  id: number;
  /** Channel-name → value map applied to the next produced block. */
  inputs: Record<string, number>;
}

/**
 * Arm a program epoch. The producer tags every subsequently-produced block
 * with the supplied epoch so the worklet activates pending graph deltas on
 * the first matching block (VAL-SAB-015 / VAL-ENGINE-011).
 */
export interface ProducerArmEpochRequest {
  type: "producerArmEpoch";
  id: number;
  /** New pending program epoch. */
  epoch: number;
}

/**
 * Devmode-only: terminate the producer from inside the Worker. The worklet
 * independently detects producer loss via the SAB liveness age and applies
 * the 10 ms emergency fade (VAL-ENGINE-023). Outside devmode this message
 * is a no-op that returns `terminated: false`.
 */
export interface ProducerTerminateRequest {
  type: "producerTerminate";
  id: number;
}

/**
 * Read a producer telemetry snapshot for devmode dashboards. Returns the
 * current ring indices, audio frame, and pending/active epochs.
 */
export interface ProducerReadTelemetryRequest {
  type: "producerReadTelemetry";
  id: number;
}

/**
 * Clear the WASM compiler's synth declarations by evaluating `(useq-clear)`.
 * Used during service recovery so the first post-recovery synth eval is not
 * rejected as an over-capacity second declaration (VAL-CROSS-009).
 */
export interface ClearSynthDeclarationsRequest {
  type: "clearSynthDeclarations";
  id: number;
}

export type WasmWorkerRequest =
  | LoadRequest
  | EvalCodeRequest
  | EvalCodeWithDiagnosticsRequest
  | UpdateTimeRequest
  | EvalOutputAtTimeRequest
  | EvalOutputsInTimeWindowRequest
  | TickAndProjectRequest
  | SyncTransportStateRequest
  | SendTransportCommandRequest
  | ReadLastDiagnosticsRequest
  | ReadActiveDiagnosticsRequest
  | SetLiveInputsRequest
  | SetHwInputValueRequest
  | ProbeSetRequest
  | ProbeSampleRequest
  | ProbeFreeRequest
  | GetLiveSlotsRequest
  | ApplyStateSnapshotRequest
  | ProducerInstallSabRequest
  | ProducerSetControlValuesRequest
  | ProducerPrepareCommitRequest
  | ProducerAbortCommitRequest
  | ProducerStartRequest
  | ProducerStopRequest
  | ProducerTransportUpdateRequest
  | ProducerApplyInputsRequest
  | ProducerArmEpochRequest
  | ProducerTerminateRequest
  | ProducerReadTelemetryRequest
  | ClearSynthDeclarationsRequest;

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

export interface EvalCodeWithDiagnosticsResponse {
  type: "evalCodeWithDiagnostics-result";
  id: number;
  /** `null` only when WASM is disabled main-side at request time. */
  result: string | null;
  /** Diagnostics emitted by *this* eval, read atomically inside the
   *  worker handler. */
  diagnostics: RuntimeDiagnostic[];
  /**
   * Versioned synth artefact payload read atomically inside the same
   * worker handler that ran the eval (VAL-COMP-013). Carries the
   * committed patch graph and control table so the main thread can
   * correlate them to this exact eval without a racing second read.
   *
   * `null` only when the WASM bundle does not export
   * `useq_synth_artifacts` (older bundles) or WASM is disabled.
   *
   * On a failed eval the payload still carries the LAST successful
   * commit's artefacts (failed evals never advance the revision or
   * mutate the published graph — VAL-COMP-010/014). The caller
   * distinguishes success from failure by inspecting `diagnostics`
   * for severity:"error"; the artefacts are intentionally retained
   * so a later engine commit can key off the stable revision.
   */
  synthArtifacts: SynthArtifactsPayload | null;
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

export interface SetHwInputValueResponse {
  type: "setHwInputValue-result";
  id: number;
}

export interface ProbeSetResponse {
  type: "probeSet-result";
  id: number;
  status: number;
}

export interface ProbeSampleResponse {
  type: "probeSample-result";
  id: number;
  /** Plain array (Float64Array is not structured-clone-portable across all browsers). */
  samples: number[] | null;
}

export interface ProbeFreeResponse {
  type: "probeFree-result";
  id: number;
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

// ─── Producer responses ────────────────────────────────────────────────────

export interface ProducerInstallSabResponse {
  type: "producerInstallSab-result";
  id: number;
  /** True when the buffer passed ABI validation and was attached. */
  installed: boolean;
}

export interface ProducerStartResponse {
  type: "producerStart-result";
  id: number;
  /** True when the producer transitioned from stopped to running. */
  started: boolean;
}

export interface ProducerSetControlValuesResponse {
  type: "producerSetControlValues-result";
  id: number;
}

export interface ProducerPrepareCommitResponse {
  type: "producerPrepareCommit-result";
  id: number;
  prepared: boolean;
}

export interface ProducerAbortCommitResponse {
  type: "producerAbortCommit-result";
  id: number;
  aborted: boolean;
}

export interface ProducerStopResponse {
  type: "producerStop-result";
  id: number;
  /** True when the producer transitioned from running to stopped. */
  stopped: boolean;
}

export interface ProducerTransportUpdateResponse {
  type: "producerTransportUpdate-result";
  id: number;
  /** Transport map revision after the transition. */
  revision: number;
}

export interface ProducerApplyInputsResponse {
  type: "producerApplyInputs-result";
  id: number;
  /** Number of input channels queued for the next produced block. */
  queued: number;
}

export interface ProducerArmEpochResponse {
  type: "producerArmEpoch-result";
  id: number;
  /** The pending epoch now tagged on every subsequently-produced block. */
  armedEpoch: number;
}

export interface ProducerTerminateResponse {
  type: "producerTerminate-result";
  id: number;
  /** True when the producer was running and is now terminated. */
  terminated: boolean;
}

/**
 * Telemetry snapshot returned by `producerReadTelemetry`. The shape mirrors
 * the producer scheduler's view of the SAB so devmode dashboards and tests
 * can validate the producer loop without a second side channel.
 */
export interface ProducerTelemetrySnapshot {
  /** Whether the producer loop is currently running. */
  running: boolean;
  /** Audio frame last observed by the producer. */
  audioFrame: bigint;
  /** Number of blocks published since `producerStart`. */
  blocksPublished: number;
  /** Current ring write index (monotonic raw counter). */
  ringWriteIndex: number;
  /** Current ring read index (monotonic raw counter). */
  ringReadIndex: number;
  /** Ring fill depth (write − read, capped at capacity). */
  ringFillDepth: number;
  /** Pending program epoch. */
  pendingEpoch: number;
  /** Active program epoch. */
  programEpoch: number;
  /** Transport map revision. */
  transportRevision: number;
  /** Transport map state. */
  transportState: "playing" | "paused" | "stopped";
}

export interface ProducerReadTelemetryResponse {
  type: "producerReadTelemetry-result";
  id: number;
  telemetry: ProducerTelemetrySnapshot | null;
}

export interface ClearSynthDeclarationsResponse {
  type: "clearSynthDeclarations-result";
  id: number;
  /** True when the WASM engine's synth declarations were cleared. */
  cleared: boolean;
}

export interface ErrorResponse {
  type: "error";
  id: number;
  message: string;
}

export type WasmWorkerResponse =
  | LoadResponse
  | EvalCodeResponse
  | EvalCodeWithDiagnosticsResponse
  | UpdateTimeResponse
  | EvalOutputAtTimeResponse
  | EvalOutputsInTimeWindowResponse
  | TickAndProjectResponse
  | SyncTransportStateResponse
  | SendTransportCommandResponse
  | ReadLastDiagnosticsResponse
  | ReadActiveDiagnosticsResponse
  | SetLiveInputsResponse
  | SetHwInputValueResponse
  | ProbeSetResponse
  | ProbeSampleResponse
  | ProbeFreeResponse
  | GetLiveSlotsResponse
  | ApplyStateSnapshotResponse
  | ProducerInstallSabResponse
  | ProducerSetControlValuesResponse
  | ProducerPrepareCommitResponse
  | ProducerAbortCommitResponse
  | ProducerStartResponse
  | ProducerStopResponse
  | ProducerTransportUpdateResponse
  | ProducerApplyInputsResponse
  | ProducerArmEpochResponse
  | ProducerTerminateResponse
  | ProducerReadTelemetryResponse
  | ClearSynthDeclarationsResponse
  | ErrorResponse;
