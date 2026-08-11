/**
 * WASM-runtime Web Worker.
 *
 * Hosts a single Emscripten-built uSEQ ModuLisp interpreter inside a
 * dedicated Web Worker so editor input + UI rendering can keep the main
 * thread for themselves. Speaks the discriminated-union protocol defined
 * in `wasmRuntimeWorkerProtocol.ts`; the main-side adapter is
 * `wasmRuntimeWorkerPort.ts`.
 *
 * Scope and tradeoffs:
 *
 *   - Worker loading and request dispatch stay local, while optional ABI,
 *     batch/projection, live-input, and probe-buffer policy come from the
 *     environment-neutral interpreter core shared with the main thread.
 *   - Diagnostics readback (`useq_last_diagnostics`,
 *     `useq_active_diagnostics`) is piped across the worker boundary
 *     via the `readLastDiagnostics` / `readActiveDiagnostics` request
 *     types. The reads run inside the worker against the
 *     worker-local `__useqWasmRuntime` global so the editor's inline
 *     diagnostics and per-frame output health both keep working when
 *     the worker port is active.
 *   - Worker loading and request dispatch remain local so the public port
 *     contract can evolve without leaking interpreter globals main-thread.
 */
/// <reference lib="webworker" />

import {
  assertWasmAbi,
  REQUIRED_WASM_EXPORTS,
  OPTIONAL_WASM_EXPORTS,
  WasmAbiMismatchError,
} from "../../contracts/wasmAbi";
import { TRANSPORT_STATE_TO_COMMAND } from "../../contracts/useqRuntimeContract";
import type {
  LiveSlotMetadata,
  ProjectionMode,
  RuntimeDiagnostic,
  SynthArtifactsPayload,
  SynthProducerControlBinding,
  TickAndProjectResult,
  TimeSample,
} from "../../contracts/runtimePorts";
import {
  bindOptionalCwrap,
  createHeapBuffer,
  createWasmBatchEvaluator,
  createWasmLiveInputController,
  createWasmProbeController,
  isBrokenOptionalExportError,
  type EmscriptenModule,
} from "../wasmInterpreterCore";
import { isSynthArtifactsPayload } from "../../contracts/runtimeTypes";
import { validateSynthProducerControlBindingsAgainstControls } from
  "../../contracts/synthProducerControlMapping";
import {
  attachSynthesisControlView,
  CONTROL_LOOKAHEAD_BLOCKS,
  createProducerPacingWaiter,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  type SynthesisControlView,
} from "../../contracts/synthesisControlAbi";
import {
  createProducerScheduler,
  type ProducedBlockAudit,
  type ProducerExecutor,
  type ProducerScheduler,
  type ProducerSchedulingClock,
} from "../../audio/producerScheduler";
import {
  createProducerLoopDriver,
  type ProducerLoopDriver,
} from "../../audio/producerLoopDriver";
import {
  createTransportFrameMap,
  type TransportFrameMap,
} from "../../audio/transportFrameMap";
import type {
  WasmWorkerRequest,
  WasmWorkerResponse,
  WorkerCapabilitySnapshot,
  ProducerTelemetrySnapshot,
} from "./wasmRuntimeWorkerProtocol";

interface EmscriptenModuleConfig {
  locateFile?: (path: string, scriptDirectory: string) => string;
}

declare const self: DedicatedWorkerGlobalScope & {
  createModule?: (config?: EmscriptenModuleConfig) => Promise<EmscriptenModule>;
  importScripts: (...urls: string[]) => void;
};

// ─── Worker-local interpreter state ────────────────────────────────────────

let wasmEnabled = true;

interface InterpreterHandle {
  module: EmscriptenModule;
  evaluate: (code: string) => string;
  updateTime: (seconds: number) => void;
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number;
  evaluateOutputsTimeWindow: (
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number,
  ) => Map<string, TimeSample[]>;
  tickAndProject: (
    outputs: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ) => TickAndProjectResult | null;
  supportsTimeWindow: () => boolean;
  supportsTickAndProject: () => boolean;
  supportsSynthControlTick: () => boolean;
  tickSynthControls: (
    time: number,
    expectedControlCount: number,
  ) => Float64Array | null;
  supportsLiveInputs: () => boolean;
  setLiveInputs: (values: Record<string, number>) => number;
  setHwInputValue: (index: number, value: number) => void;
  probeSet: (slot: number, code: string) => number;
  probeSample: (slot: number, startTime: number, endTime: number, count: number) => Float64Array | null;
  probeFree: (slot: number) => void;
  getLiveSlots: () => LiveSlotMetadata[];
  applyStateSnapshot: (json: string) => boolean;
  setFailureMode: (mode: "lkg" | "zero") => boolean;
  release: () => void;
}

let interpreter: InterpreterHandle | null = null;

// ─── Producer state (audio-clocked future-control) ─────────────────────────
//
// The producer turns this Worker into the audio-clocked future-control
// producer. It owns:
//   - the SAB-backed SynthesisControlView (after `producerInstallSab`);
//   - the TransportFrameMap (constructed on `producerStart`);
//   - the ProducerScheduler (constructed on `producerStart`);
//   - a task-yielding scheduling loop that drives `iterate()` between Worker
//     message-handler invocations.
//
// The producer is the SOLE caller of `view.advanceWriteIndex`. The
// worklet consumes the ring without ever blocking (VAL-SAB-019).
// Producer pacing follows synthesis.md §4.1: between iterations the
// scheduler blocks on the SAB wake word via `createProducerPacingWaiter`
// until the worklet's next `publishAudioFrame` notify (bounded by
// `PRODUCER_WAKE_WAIT_CAP_MS` so the Worker inbox stays live), with the
// `setTimeout(0)` macrotask yield preserved so message handling runs.

let controlView: SynthesisControlView | null = null;
let pacingWaiter: ((maxWaitMs: number) => void) | null = null;
let transportMap: TransportFrameMap | null = null;
let producer: ProducerScheduler | null = null;
let producerRunning = false;
let producerLoopDriver: ProducerLoopDriver | null = null;
let producerBlocksPublished = 0;
// Per-(node, param) channel list in commit-plan order — the array index
// equals the SAB block-rate channel index (M2.2 channel table). Mutated
// IN PLACE (never reassigned): the running producer scheduler captures
// the array reference at construction, so an in-place refill re-arms a
// live producer without a stop/start cycle.
const producerBlockRateChannels: string[] = [];
const producerControlBindings: SynthProducerControlBinding[] = [];
let producerCompilerControlCount = 0;
interface PreparedProducerCommit {
  epoch: number;
  compilerControlCount: number;
  controlBindings: SynthProducerControlBinding[];
  previousEpoch: number;
  previousCompilerControlCount: number;
  previousControlBindings: SynthProducerControlBinding[];
}
let preparedProducerCommit: PreparedProducerCommit | null = null;
let lastArmedProducerCommit: PreparedProducerCommit | null = null;

function rearmProducerChannels(channels: readonly string[]): void {
  producerBlockRateChannels.length = 0;
  for (const channel of channels) {
    producerBlockRateChannels.push(channel);
  }
}

function rearmProducerControlMapping(
  compilerControlCount: number,
  bindings: readonly SynthProducerControlBinding[],
): void {
  producerCompilerControlCount = compilerControlCount;
  producerControlBindings.length = 0;
  for (const binding of bindings) producerControlBindings.push({ ...binding });
  rearmProducerChannels(bindings.map((binding) => binding.channelKey));
}
const producerAudit: ProducedBlockAudit[] = [];

/**
 * Producer pacing clock. `sleep` blocks on the SAB wake word so each
 * scheduler iteration lines up with a worklet block publication rather
 * than free-running (synthesis.md §4.1). The wait is bounded (see
 * `createProducerPacingWaiter`), and the loop driver's `setTimeout(0)`
 * macrotask yield still runs between iterations so the Worker inbox
 * (eval requests, producer-stop) is never starved.
 */
const producerClock: ProducerSchedulingClock = {
  now(): number {
    return Date.now();
  },
  sleep(ms: number): void {
    pacingWaiter?.(ms);
  },
};

/**
 * Executor adapter that drives the existing interpreter handle. The
 * producer never constructs a second interpreter; it only routes
 * `liveTick` calls to the compiler's single live tick/control export plus
 * the existing `setLiveInputs` surface (VAL-ENGINE-001).
 *
 * The adapter returns a record of channel-name → value for the supplied
 * ModuLisp time. Channel names that do not match an active output
 * return NaN (the producer replaces non-finite values with zero).
 */
const producerExecutor: ProducerExecutor = {
  liveTick(time, inputs) {
    if (!interpreter) return {};
    // Apply external inputs first so the tick observes them (the
    // interpreter's setLiveInputs is the existing main-thread path).
    if (Object.keys(inputs).length > 0) {
      try {
        interpreter.setLiveInputs(inputs);
      } catch {
        // Best-effort: inputs that fail to apply fall back to the
        // existing live-slot values.
      }
    }
    const out: Record<string, number> = {};
    // The compiler returns one sample per artefact control row in exact
    // compiler order. The validated mapping retains original indices while
    // filtering to the SAB's block-rate rows, so signal expressions are
    // sampled every block instead of replaced with commit-time defaults.
    const samples = interpreter.tickSynthControls(
      time,
      producerCompilerControlCount,
    );
    if (!samples) return out;
    for (const binding of producerControlBindings) {
      const value = samples[binding.compilerControlIndex];
      if (typeof value === "number") out[binding.channelKey] = value;
    }
    return out;
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function postResponse(response: WasmWorkerResponse): void {
  self.postMessage(response);
}

// ─── Interpreter bootstrap (one-shot) ──────────────────────────────────────

async function instantiateInterpreter(scriptUrl: string): Promise<InterpreterHandle> {
  // `createModule` is exposed as a global by the Emscripten bundle.
  if (typeof self.createModule !== "function") {
    self.importScripts(scriptUrl);
  }
  const factory = self.createModule;
  if (typeof factory !== "function") {
    throw new Error("uSEQ WASM bundle did not expose createModule() inside worker");
  }
  // The Emscripten bundle is built for ENVIRONMENT_IS_WEB and resolves
  // sibling assets via `document.currentScript.src` — undefined in a worker
  // scope, leaving `scriptDirectory` empty and the wasm fetch resolving
  // against the worker bundle's URL (`/solid-dist/assets/`) instead of
  // `/wasm/`. Override `locateFile` with the directory of the script we
  // just imported so `useq.wasm` is fetched from the correct origin.
  const wasmDirectory = new URL(".", scriptUrl).href;
  const module = await factory({
    locateFile: (path: string) => new URL(path, wasmDirectory).href,
  });

  assertWasmAbi(module);

  const initDesc = REQUIRED_WASM_EXPORTS.useq_init;
  const useq_init = module.cwrap(
    initDesc.symbol,
    initDesc.returnType,
    initDesc.argTypes as unknown as string[],
  ) as () => void;

  const evalDesc = REQUIRED_WASM_EXPORTS.useq_eval;
  const useq_eval = module.cwrap(
    evalDesc.symbol,
    evalDesc.returnType,
    evalDesc.argTypes as unknown as string[],
  ) as (code: string) => string;

  const timeDesc = REQUIRED_WASM_EXPORTS.useq_update_time;
  const useq_update_time = module.cwrap(
    timeDesc.symbol,
    timeDesc.returnType,
    timeDesc.argTypes as unknown as string[],
  ) as (t: number) => void;

  const outputDesc = REQUIRED_WASM_EXPORTS.useq_eval_output;
  const useq_eval_output = module.cwrap(
    outputDesc.symbol,
    outputDesc.returnType,
    outputDesc.argTypes as unknown as string[],
  ) as (name: string, t: number) => number;

  const evaluateOutputAtTime = (name: string, time: number): number => {
    const value = useq_eval_output(name, Number(time) || 0);
    return Number.isNaN(value) ? Number.NaN : value;
  };
  const batchEvaluator = createWasmBatchEvaluator(
    module,
    evaluateOutputAtTime,
  );
  const liveInputs = createWasmLiveInputController(module);
  const probes = createWasmProbeController(module);
  const synthControlBuffer = createHeapBuffer(
    module,
    "uSEQ synth-control buffer",
  );

  // Diagnostic readers must be reachable via `globalThis.__useqWasmRuntime`
  // because `readLast/ActiveDiagnosticsLocal` (below) read from that handle
  // rather than holding a direct module reference.
  const lastDiagsFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_last_diagnostics,
  ) as (() => string) | null;
  const activeDiagsFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_active_diagnostics,
  ) as (() => string) | null;
  const synthArtifactsFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_synth_artifacts,
  ) as (() => string) | null;
  let tickSynthControlsFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_tick_synth_controls,
  ) as ((time: number, bufferPtr: number, bufferLength: number) => number) | null;
  const setFailureModeFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_set_failure_mode,
  ) as ((mode: number) => number) | null;
  (globalThis as { __useqWasmRuntime?: UseqRuntimeGlobal }).__useqWasmRuntime = {
    useq_last_diagnostics: lastDiagsFn ?? undefined,
    useq_active_diagnostics: activeDiagsFn ?? undefined,
    useq_synth_artifacts: synthArtifactsFn ?? undefined,
  };

  useq_init();

  return {
    module,
    evaluate: (code: string): string => useq_eval(code),
    updateTime: (s: number): void => useq_update_time(Number(s) || 0),
    evaluateOutputAtTime,
    evaluateOutputsTimeWindow: batchEvaluator.evaluate,
    tickAndProject: batchEvaluator.tickAndProject,
    supportsTimeWindow: batchEvaluator.supportsTimeWindow,
    supportsTickAndProject: batchEvaluator.supportsTickAndProject,
    supportsSynthControlTick: (): boolean => tickSynthControlsFn !== null,
    tickSynthControls: (
      time: number,
      expectedControlCount: number,
    ): Float64Array | null => {
      if (
        !tickSynthControlsFn ||
        !Number.isFinite(time) ||
        !Number.isSafeInteger(expectedControlCount) ||
        expectedControlCount < 0
      ) return null;
      try {
        const { pointer, view } = synthControlBuffer.ensure(
          expectedControlCount,
        );
        const written = tickSynthControlsFn(
          time,
          pointer,
          expectedControlCount,
        );
        if (written !== expectedControlCount) return null;
        return expectedControlCount === 0
          ? new Float64Array(0)
          : view.subarray(0, expectedControlCount);
      } catch (error) {
        if (isBrokenOptionalExportError(error)) tickSynthControlsFn = null;
        return null;
      }
    },
    supportsLiveInputs: () => liveInputs.supported,
    setLiveInputs: liveInputs.set,
    setHwInputValue: liveInputs.setHardwareInput,
    probeSet: probes.set,
    probeSample: probes.sample,
    probeFree: probes.free,
    getLiveSlots: liveInputs.getSlots,
    applyStateSnapshot: liveInputs.applyStateSnapshot,
    setFailureMode: (mode) => {
      if (!setFailureModeFn) return false;
      const requested = mode === "zero" ? 1 : 0;
      return setFailureModeFn(requested) === requested;
    },
    release: () => {
      batchEvaluator.release();
      probes.release();
      synthControlBuffer.release();
    },
  };
}

// ─── Diagnostic readers (worker-local) ─────────────────────────────────────
//
// The Emscripten bundle running inside the worker exposes the diagnostic
// exports on the `__useqWasmRuntime` global; reading from the worker
// scope is what keeps inline editor diagnostics and per-frame output
// health alive when the worker port is the active port.

interface UseqRuntimeGlobal {
  useq_last_diagnostics?: () => string;
  useq_active_diagnostics?: () => string;
  /**
   * Versioned synth artefact snapshot (synth-nodes.md §7.2 /
   * VAL-COMP-009/012/015). Mirrors the `useq_synth_artifacts` WASM export.
   * Read atomically inside the eval handler alongside the diagnostics so
   * the response carries the exact-eval synth commit.
   */
  useq_synth_artifacts?: () => string;
}

function getUseqRuntimeGlobal(): UseqRuntimeGlobal | undefined {
  return (globalThis as { __useqWasmRuntime?: UseqRuntimeGlobal })
    .__useqWasmRuntime;
}

function readLastDiagnosticsLocal(): RuntimeDiagnostic[] {
  try {
    const runtime = getUseqRuntimeGlobal();
    if (!runtime?.useq_last_diagnostics) return [];
    const json = runtime.useq_last_diagnostics();
    return json ? (JSON.parse(json) as RuntimeDiagnostic[]) : [];
  } catch {
    return [];
  }
}

let _lastActiveDiagsJson = "";
let _lastActiveDiagsResult: RuntimeDiagnostic[] = [];

function readActiveDiagnosticsLocal(): RuntimeDiagnostic[] {
  try {
    const runtime = getUseqRuntimeGlobal();
    if (!runtime?.useq_active_diagnostics) return _lastActiveDiagsResult;
    const json = runtime.useq_active_diagnostics();
    if (!json) return _lastActiveDiagsResult;
    if (json === _lastActiveDiagsJson) return _lastActiveDiagsResult;
    _lastActiveDiagsJson = json;
    _lastActiveDiagsResult = JSON.parse(json) as RuntimeDiagnostic[];
    return _lastActiveDiagsResult;
  } catch {
    return _lastActiveDiagsResult;
  }
}

/**
 * Read the versioned synth artefact snapshot from the worker-local WASM
 * global. Used by the `evalCodeWithDiagnostics` handler so the exact-eval
 * Worker response carries the synth commit alongside diagnostics and the
 * eval result (VAL-COMP-013).
 *
 * Returns `null` when the export is unavailable or the payload does not
 * parse. Callers MUST consult `payload.abi` against
 * `SYNTH_ARTIFACT_ABI_VERSION` before interpreting the body bytes.
 */
function readSynthArtifactsLocal(): SynthArtifactsPayload | null {
  try {
    const runtime = getUseqRuntimeGlobal();
    if (!runtime?.useq_synth_artifacts) return null;
    const json = runtime.useq_synth_artifacts();
    if (!json) return null;
    return JSON.parse(json) as SynthArtifactsPayload;
  } catch {
    return null;
  }
}

// ─── Capability snapshot ───────────────────────────────────────────────────

function snapshotCapabilities(): WorkerCapabilitySnapshot {
  return {
    enabled: wasmEnabled,
    supportsEval: wasmEnabled && interpreter !== null,
    supportsTimeWindow:
      wasmEnabled && interpreter !== null && interpreter.supportsTimeWindow(),
    supportsTickAndProject:
      wasmEnabled && interpreter !== null && !producerRunning &&
      interpreter.supportsTickAndProject(),
    supportsLiveInputs:
      wasmEnabled && interpreter !== null && interpreter.supportsLiveInputs(),
  };
}

// ─── Request dispatch ──────────────────────────────────────────────────────

async function handleRequest(request: WasmWorkerRequest): Promise<void> {
  const { id } = request;
  try {
    switch (request.type) {
      case "load": {
        wasmEnabled = !!request.enabled;
        if (!interpreter) {
          interpreter = await instantiateInterpreter(request.scriptUrl);
        }
        postResponse({
          type: "load-result",
          id,
          capabilities: snapshotCapabilities(),
        });
        return;
      }
      case "evalCode": {
        if (!wasmEnabled) {
          postResponse({ type: "evalCode-result", id, result: null });
          return;
        }
        if (!interpreter) throw new Error("WASM worker: interpreter not loaded");
        const result = interpreter.evaluate(request.code);
        postResponse({ type: "evalCode-result", id, result });
        return;
      }
      case "evalCodeWithDiagnostics": {
        if (!wasmEnabled) {
          postResponse({
            type: "evalCodeWithDiagnostics-result",
            id,
            result: null,
            diagnostics: [],
            synthArtifacts: null,
          });
          return;
        }
        if (!interpreter) throw new Error("WASM worker: interpreter not loaded");
        const result = interpreter.evaluate(request.code);
        // Read diagnostics AND the synth artefact payload in the same
        // handler so they belong to this eval — any concurrent eval queued
        // behind us has not run yet, so `useq_last_diagnostics` and
        // `useq_synth_artifacts` are still ours. The artefacts reflect the
        // LAST successful synth commit; on a failed eval they retain the
        // previous snapshot (VAL-COMP-010/014) and the caller distinguishes
        // success from failure via the `diagnostics` array.
        const diagnostics = readLastDiagnosticsLocal();
        const synthArtifacts = readSynthArtifactsLocal();
        postResponse({
          type: "evalCodeWithDiagnostics-result",
          id,
          result,
          diagnostics,
          synthArtifacts,
        });
        return;
      }
      case "updateTime": {
        if (wasmEnabled && interpreter) {
          interpreter.updateTime(request.timeSeconds);
        }
        postResponse({ type: "updateTime-result", id });
        return;
      }
      case "evalOutputAtTime": {
        if (!wasmEnabled || !interpreter) {
          postResponse({ type: "evalOutputAtTime-result", id, value: Number.NaN });
          return;
        }
        const value = interpreter.evaluateOutputAtTime(
          request.name,
          request.timeSeconds,
        );
        postResponse({ type: "evalOutputAtTime-result", id, value });
        return;
      }
      case "evalOutputsInTimeWindow": {
        if (!wasmEnabled || !interpreter) {
          postResponse({
            type: "evalOutputsInTimeWindow-result",
            id,
            samples: new Map(),
            supportsTimeWindow: false,
          });
          return;
        }
        const samples = interpreter.evaluateOutputsTimeWindow(
          request.outputs,
          request.startTime,
          request.endTime,
          request.numSamples,
        );
        postResponse({
          type: "evalOutputsInTimeWindow-result",
          id,
          samples,
          supportsTimeWindow: interpreter.supportsTimeWindow(),
        });
        return;
      }
      case "tickAndProject": {
        if (!wasmEnabled || !interpreter || producerRunning) {
          // `useq_tick_synth_controls` is the sole live-VM advancement path
          // while audio is running. Visualisation falls back to the read-only
          // time-window evaluator rather than double-ticking stateful graphs.
          postResponse({
            type: "tickAndProject-result",
            id,
            result: null,
            supportsTickAndProject: false,
          });
          return;
        }
        const result = interpreter.tickAndProject(
          request.outputs,
          request.tickTime,
          (request.projectionMode ?? 0) as ProjectionMode,
          request.projectEnd,
          request.numFutureSamples,
          request.projectionOrigin ?? request.tickTime,
        );
        postResponse({
          type: "tickAndProject-result",
          id,
          result,
          supportsTickAndProject:
            !producerRunning && interpreter.supportsTickAndProject(),
        });
        return;
      }
      case "syncTransportState": {
        const command = TRANSPORT_STATE_TO_COMMAND[request.state];
        if (wasmEnabled && interpreter && command) {
          interpreter.evaluate(command);
        }
        postResponse({ type: "syncTransportState-result", id });
        return;
      }
      case "sendTransportCommand": {
        if (wasmEnabled && interpreter) {
          interpreter.evaluate(request.command);
        }
        postResponse({ type: "sendTransportCommand-result", id });
        return;
      }
      case "readLastDiagnostics": {
        postResponse({
          type: "readLastDiagnostics-result",
          id,
          diagnostics: readLastDiagnosticsLocal(),
        });
        return;
      }
      case "readActiveDiagnostics": {
        postResponse({
          type: "readActiveDiagnostics-result",
          id,
          diagnostics: readActiveDiagnosticsLocal(),
        });
        return;
      }
      case "setFailureMode": {
        const accepted = !!(wasmEnabled && interpreter?.setFailureMode(request.mode));
        postResponse({ type: "setFailureMode-result", id, accepted });
        return;
      }
      case "setLiveInputs": {
        let applied = 0;
        if (wasmEnabled && interpreter) {
          applied = interpreter.setLiveInputs(request.values);
        }
        postResponse({ type: "setLiveInputs-result", id, applied });
        return;
      }
      case "setHwInputValue": {
        if (wasmEnabled && interpreter) {
          interpreter.setHwInputValue(request.index, request.value);
        }
        postResponse({ type: "setHwInputValue-result", id });
        return;
      }
      case "probeSet": {
        const status = wasmEnabled && interpreter
          ? interpreter.probeSet(request.slot, request.code)
          : -1;
        postResponse({ type: "probeSet-result", id, status });
        return;
      }
      case "probeSample": {
        const samples = wasmEnabled && interpreter
          ? interpreter.probeSample(request.slot, request.startTime, request.endTime, request.count)
          : null;
        postResponse({
          type: "probeSample-result",
          id,
          samples: samples ? Array.from(samples) : null,
        });
        return;
      }
      case "probeFree": {
        if (wasmEnabled && interpreter) {
          interpreter.probeFree(request.slot);
        }
        postResponse({ type: "probeFree-result", id });
        return;
      }
      case "getLiveSlots": {
        const slots: LiveSlotMetadata[] =
          wasmEnabled && interpreter ? interpreter.getLiveSlots() : [];
        postResponse({ type: "getLiveSlots-result", id, slots });
        return;
      }
      case "applyStateSnapshot": {
        let success = false;
        if (wasmEnabled && interpreter) {
          success = interpreter.applyStateSnapshot(JSON.stringify(request.snapshot));
        }
        postResponse({ type: "applyStateSnapshot-result", id, success });
        return;
      }
      case "producerInstallSab": {
        try {
          const view = attachSynthesisControlView(request.controlBuffer);
          controlView = view;
          pacingWaiter = createProducerPacingWaiter(request.controlBuffer);
          preparedProducerCommit = null;
          lastArmedProducerCommit = null;
          rearmProducerControlMapping(0, []);
          // Reset the audit so devmode traces reflect this session only.
          producerAudit.length = 0;
          producerBlocksPublished = 0;
          postResponse({ type: "producerInstallSab-result", id, installed: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          postResponse({
            type: "producerInstallSab-result",
            id,
            installed: false,
          });
          // Surface the underlying cause on the regular error channel so
          // devmode dashboards see the failure without changing shape.
          void message;
        }
        return;
      }
      case "producerPrepareCommit": {
        if (
          !controlView ||
          !interpreter?.supportsSynthControlTick() ||
          !Number.isSafeInteger(request.epoch) ||
          request.epoch <= 0
        ) {
          postResponse({ type: "producerPrepareCommit-result", id, prepared: false });
          return;
        }
        const compilerArtifacts = readSynthArtifactsLocal();
        if (
          !isSynthArtifactsPayload(compilerArtifacts) ||
          compilerArtifacts.controls.length !== request.compilerControlCount
        ) {
          postResponse({ type: "producerPrepareCommit-result", id, prepared: false });
          return;
        }
        const mapping = validateSynthProducerControlBindingsAgainstControls(
          compilerArtifacts.controls,
          request.controlBindings,
          controlView.blockRateCount,
        );
        if (!mapping.ok) {
          postResponse({ type: "producerPrepareCommit-result", id, prepared: false });
          return;
        }
        preparedProducerCommit = {
          epoch: request.epoch,
          compilerControlCount: request.compilerControlCount,
          controlBindings: request.controlBindings.map((binding) => ({ ...binding })),
          previousEpoch: controlView.pendingEpoch,
          previousCompilerControlCount: producerCompilerControlCount,
          previousControlBindings: producerControlBindings.map((binding) => ({ ...binding })),
        };
        postResponse({ type: "producerPrepareCommit-result", id, prepared: true });
        return;
      }
      case "producerAbortCommit": {
        let aborted = false;
        if (preparedProducerCommit?.epoch === request.epoch) {
          preparedProducerCommit = null;
          aborted = true;
        }
        if (lastArmedProducerCommit?.epoch === request.epoch && controlView) {
          rearmProducerControlMapping(
            lastArmedProducerCommit.previousCompilerControlCount,
            lastArmedProducerCommit.previousControlBindings,
          );
          controlView.pendingEpoch = lastArmedProducerCommit.previousEpoch;
          // Candidate blocks may already be queued even though the worklet's
          // final activation gate failed. Drop the whole lookahead window so
          // the prior graph can never consume candidate-layout values; the
          // running producer immediately refills it from the restored layout.
          controlView.ringReadIndex = controlView.ringWriteIndex;
          lastArmedProducerCommit = null;
          aborted = true;
        }
        postResponse({ type: "producerAbortCommit-result", id, aborted });
        return;
      }
      case "producerStart": {
        if (!controlView) {
          postResponse({ type: "producerStart-result", id, started: false });
          return;
        }
        const sampleRate = Number(request.sampleRate) || controlView.renderQuantumFrames * 1000;
        transportMap = createTransportFrameMap({ sampleRate });
        const anchorFrame = request.anchorFrame ?? controlView.audioFrame;
        const anchorTime = request.anchorTime ?? 0;
        transportMap.start({ atFrame: anchorFrame, atTime: anchorTime });
        producer = createProducerScheduler({
          clock: producerClock,
          executor: producerExecutor,
          view: controlView,
          map: transportMap,
          blockRateChannels: producerBlockRateChannels,
          lookaheadBlocks:
            request.lookaheadBlocks ?? CONTROL_LOOKAHEAD_BLOCKS,
          renderQuantumFrames:
            request.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES,
          audit: producerAudit,
        });
        producer.start();
        producerRunning = true;
        // Replace any previously-terminated driver so cancellation
        // generation is reset. The driver schedules every turn via
        // unconditional setTimeout(0), which yields to the Worker inbox
        // between iterations. This interim pacing deviation from
        // synthesis.md §4.1 is tracked in ergo task 019f8086-8a25
        // ("Atomics.wait producer pacing absent").
        producerLoopDriver = createProducerLoopDriver({
          iterate: () => {
            if (!producerRunning || !producer) return;
            const before = producerAudit.length;
            producer.iterate();
            producerBlocksPublished += producerAudit.length - before;
          },
          yieldToQueue: (runNext) => {
            // setTimeout(0) is the unconditional macrotask loop budget;
            // postMessage dispatch runs between iterations, so
            // eval/transport/lifecycle messages stay responsive while
            // each scheduler iteration remains bounded by
            // PRODUCER_POLL_INTERVAL_MS.
            setTimeout(runNext, 0);
          },
        });
        producerLoopDriver.start();
        postResponse({ type: "producerStart-result", id, started: true });
        return;
      }
      case "producerStop": {
        const wasRunning = producerRunning;
        producer?.stop();
        producerRunning = false;
        producer = null;
        // Cancel every future producer callback. The driver's generation
        // counter bumps so any already-queued setTimeout callback becomes
        // a no-op when it fires (VAL-ENGINE-006 / Ergo ca5e1cc3).
        producerLoopDriver?.stop();
        producerLoopDriver = null;
        postResponse({
          type: "producerStop-result",
          id,
          stopped: wasRunning,
        });
        return;
      }
      case "producerTransportUpdate": {
        if (!transportMap) {
          postResponse({
            type: "producerTransportUpdate-result",
            id,
            revision: 0,
          });
          return;
        }
        const opts = { atFrame: request.atFrame, atTime: request.atTime };
        switch (request.transition) {
          case "start":
            transportMap.start(opts);
            break;
          case "pause":
            transportMap.pause(opts);
            break;
          case "resume":
            transportMap.resume(opts);
            break;
          case "stop":
            transportMap.stop({ atFrame: request.atFrame });
            break;
          case "reanchor":
            transportMap.reanchor(opts);
            break;
        }
        postResponse({
          type: "producerTransportUpdate-result",
          id,
          revision: transportMap.revision(),
        });
        return;
      }
      case "producerApplyInputs": {
        if (!producer) {
          postResponse({ type: "producerApplyInputs-result", id, queued: 0 });
          return;
        }
        producer.applyInputs(request.inputs);
        postResponse({
          type: "producerApplyInputs-result",
          id,
          queued: Object.keys(request.inputs).length,
        });
        return;
      }
      case "producerArmEpoch": {
        if (!controlView || !preparedProducerCommit) {
          postResponse({ type: "producerArmEpoch-result", id, armedEpoch: 0 });
          return;
        }
        if (preparedProducerCommit.epoch !== request.epoch) {
          postResponse({ type: "producerArmEpoch-result", id, armedEpoch: 0 });
          return;
        }
        const armed = preparedProducerCommit;
        rearmProducerControlMapping(
          armed.compilerControlCount,
          armed.controlBindings,
        );
        lastArmedProducerCommit = armed;
        preparedProducerCommit = null;
        controlView.pendingEpoch = request.epoch;
        postResponse({
          type: "producerArmEpoch-result",
          id,
          armedEpoch: controlView.pendingEpoch,
        });
        return;
      }
      case "producerTerminate": {
        const wasRunning = producerRunning;
        producer?.stop();
        producerRunning = false;
        producer = null;
        // Cancellation must reach every already-queued setTimeout
        // callback so the devmode fault path guarantees no further
        // producer callbacks fire (VAL-ENGINE-006 / Ergo ca5e1cc3).
        producerLoopDriver?.stop();
        producerLoopDriver = null;
        postResponse({
          type: "producerTerminate-result",
          id,
          terminated: wasRunning,
        });
        return;
      }
      case "clearSynthDeclarations": {
        // VAL-CROSS-009 post-recovery eval-pipeline fix: clear the
        // WASM compiler's synth declarations by evaluating (useq-clear).
        // The synth declarations persist across service recovery (the
        // Worker is not recreated); without this clear the stale
        // declaration triggers the M1 single-node capacity diagnostic
        // on the first post-recovery eval.
        if (!wasmEnabled || !interpreter) {
          postResponse({
            type: "clearSynthDeclarations-result",
            id,
            cleared: false,
          });
          return;
        }
        try {
          interpreter.evaluate("(useq-clear)");
          postResponse({
            type: "clearSynthDeclarations-result",
            id,
            cleared: true,
          });
        } catch {
          postResponse({
            type: "clearSynthDeclarations-result",
            id,
            cleared: false,
          });
        }
        return;
      }
      case "producerReadTelemetry": {
        const telemetry: ProducerTelemetrySnapshot | null =
          controlView && transportMap
            ? {
                running: producerRunning,
                audioFrame: controlView.audioFrame,
                blocksPublished: producerBlocksPublished,
                ringWriteIndex: controlView.ringWriteIndex,
                ringReadIndex: controlView.ringReadIndex,
                ringFillDepth: controlView.ringFillDepth(),
                pendingEpoch: controlView.pendingEpoch,
                programEpoch: controlView.programEpoch,
                transportRevision: transportMap.revision(),
                transportState: transportMap.state(),
              }
            : null;
        postResponse({
          type: "producerReadTelemetry-result",
          id,
          telemetry,
        });
        return;
      }
      default: {
        // Exhaustiveness check.
        const _exhaustive: never = request;
        void _exhaustive;
        throw new Error(`WASM worker: unknown request type`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postResponse({
      type: "error",
      id,
      code: error instanceof WasmAbiMismatchError
        ? "abi-mismatch"
        : "runtime-error",
      message,
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WasmWorkerRequest>) => {
  const data = event.data;
  if (!data || typeof data !== "object" || typeof (data as any).id !== "number") {
    return;
  }
  void handleRequest(data);
  // The producer loop is driven by `producerLoopDriver`, which yields to
  // the Worker task queue between iterations via setTimeout(0). Messages
  // dispatched here therefore interleave fairly with producer turns
  // (VAL-ENGINE-006 / Ergo ca5e1cc3). No recursive queueMicrotask pump
  // is permitted: that would starve the inbox.
});

// ─── Producer task-yielding loop (Ergo ca5e1cc3) ───────────────────────────
//
// The producer loop is driven by `producerLoopDriver` (see
// `src/audio/producerLoopDriver.ts`). The driver schedules each
// iteration via `setTimeout(0)` — a macrotask — so `postMessage`
// events dispatched to the handler above run between iterations.
//
// Anti-starvation property (VAL-ENGINE-006): every iteration yields to
// the Worker task queue before the next iteration is scheduled. The
// recursive `queueMicrotask` pump that used to live here ran
// indefinitely between macrotask dispatches and starved every queued
// eval/transport/lifecycle request after `producerStart`. The driver
// fixes that by construction: microtask self-replenishment is
// impossible because the only scheduling primitive is the host's
// `yieldToQueue` hook, which the Worker wires to setTimeout.
//
// Cancellation (producerStop / producerTerminate) flips the driver's
// `running` flag and bumps its generation counter, so any
// already-queued setTimeout callback becomes a no-op when it fires.

// Release heap-allocated buffer when the worker is closing.
self.addEventListener("close", () => {
  producer?.stop();
  producerLoopDriver?.stop();
  producerLoopDriver = null;
  producerRunning = false;
  producer = null;
  controlView = null;
  pacingWaiter = null;
  transportMap = null;
  if (interpreter) {
    interpreter.release();
    interpreter = null;
  }
});
