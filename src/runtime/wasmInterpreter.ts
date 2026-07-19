import { dbg } from "../lib/debug.ts";
import { perf } from "../lib/perfTrace.ts";
import { getAppSettings } from "./appSettingsRepository.ts";
import { TRANSPORT_STATE_TO_COMMAND } from "../contracts/useqRuntimeContract";
import { codeEvaluated as codeEvaluatedChannel } from "../contracts/runtimeChannels";
import {
  assertWasmAbi,
  probeOptionalWasmExport,
  REQUIRED_WASM_EXPORTS,
  OPTIONAL_WASM_EXPORTS,
  type WasmAbiValidation,
  type CwrapDescriptor,
} from "../contracts/wasmAbi";
import type { ProjectionMode } from "../contracts/runtimePorts";

/** Time-series sample point */
export interface TimeSample {
  time: number;
  value: number;
}

/** Map of channel name to sample series */
export type SampleSeriesMap = Map<string, TimeSample[]>;

/** Result shape for the combined tick + project ABI (`useq_tick_and_project`). */
export interface TickAndProjectResult {
  /** Map of channel name → tick value at `tickTime`. NaN for inactive outputs. */
  tickValues: Map<string, number>;
  /** Map of channel name → projection samples between `tickTime` and `projectEnd`. */
  projectionSamples: SampleSeriesMap;
}

/** Transport states the WASM interpreter understands */
export type TransportState = 'playing' | 'paused' | 'stopped';

/**
 * Shape of the `globalThis.__useqWasmRuntime` handle exposed to diagnostic
 * readers and live-edit slot access. Set by the WASM init paths (main-thread
 * and worker) so helpers can pull structured data without holding a direct
 * module reference.
 */
export interface UseqWasmRuntimeGlobal {
  useq_last_diagnostics?: () => string;
  useq_active_diagnostics?: () => string;
  useq_set_live_inputs?: (json: string) => number;
  useq_get_live_slots?: () => string;
  useq_apply_state_snapshot?: (json: string) => number;
  useq_set_input_value?: (channel: number, value: number) => void;
  useq_set_failure_mode?: (mode: number) => number;
  useq_get_failure_mode?: () => number;
  /**
   * Versioned synth artefact snapshot (synth-nodes.md §7.2 /
   * VAL-COMP-009/012/015). Mirrors the `useq_synth_artifacts` WASM export.
   * Returns a JSON object shaped
   *   {"abi":N,"revision":R,"declarations":[...],"controls":[...]}
   * that is stable until the next eval commits a new synth graph.
   */
  useq_synth_artifacts?: () => string;
}

// Emscripten module interface (minimal typing for what we use)
interface EmscriptenModule {
  cwrap(symbol: string, returnType: string | null, argTypes: string[]): (...args: any[]) => any;
  _malloc(size: number): number;
  _free(pointer: number): void;
  // Exposed via src-useq/wasm/emscripten-post.js so the typed batch bridge can
  // read values written into the WASM heap without relying on stale copies.
  HEAPF64: Float64Array;
}

/** Runtime interface for the instantiated WASM interpreter */
interface UseqRuntime {
  module: EmscriptenModule;
  evaluate: (code: string) => string;
  updateTime: (seconds: number) => void;
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number;
  evaluateOutputsTimeWindow: (outputs: string[], startTime: number, endTime: number, numSamples: number) => SampleSeriesMap;
  tickAndProjectOutputs: (
    outputs: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ) => TickAndProjectResult | null;
  supportsTimeWindow: boolean;
  supportsTickAndProject: boolean;
  probeSet: (slot: number, code: string) => number;
  probeSample: (slot: number, start: number, end: number, count: number) => Float64Array | null;
  probeFree: (slot: number) => void;
  supportsProbeSlots: boolean;
  release: () => void;
}

// Extend Window to include the createModule factory
declare global {
  interface Window {
    createModule?: () => Promise<EmscriptenModule>;
  }
}

const WASM_SCRIPT_URL = "wasm/useq.js";
let scriptLoadPromise: Promise<void> | null = null;
let runtimePromise: Promise<UseqRuntime> | null = null;
let lastKnownTimeWindowSupport = false;
let lastKnownTickAndProjectSupport = false;
let lastKnownLiveInputsSupport = false;
let classificationsFnStored: (() => string) | null = null;
let dependenciesFnStored: ((idx: number) => number) | null = null;
function isUseqWasmEnabled(): boolean {
  try {
    return getAppSettings()?.wasm?.enabled ?? true;
  } catch (_e) {
    return true;
  }
}

function bindOptionalCwrap(
  module: EmscriptenModule,
  desc: CwrapDescriptor
): ((...args: any[]) => any) | null {
  if (!probeOptionalWasmExport(module, desc)) {
    dbg(`useqWasmInterpreter: ${desc.symbol} is not available on this WASM bundle`);
    return null;
  }

  try {
    return module.cwrap(
      desc.symbol,
      desc.returnType,
      desc.argTypes as unknown as string[]
    );
  } catch (error) {
    dbg(`useqWasmInterpreter: failed to bind ${desc.symbol} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function isBrokenOptionalExportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "TypeError" &&
    /func is not a function/i.test(error.message)
  );
}

function clampSampleCount(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(numeric));
}

type ReadValueFn = (channelIndex: number, sampleIndex: number) => number;

interface SampleSeriesCache {
  byOutput: Map<string, TimeSample[]>;
}

function getReusableSeries(
  cache: SampleSeriesCache | undefined,
  output: string,
  sampleCount: number,
): TimeSample[] {
  if (!cache) {
    return new Array<TimeSample>(sampleCount);
  }

  const existing = cache.byOutput.get(output);
  if (existing && existing.length === sampleCount) {
    return existing;
  }

  const created = Array.from({ length: sampleCount }, () => ({ time: 0, value: 0 }));
  cache.byOutput.set(output, created);
  return created;
}

function buildSampleSeries(
  outputs: string[],
  startTime: number,
  endTime: number,
  sampleCount: number,
  readValue: ReadValueFn,
  cache?: SampleSeriesCache,
): SampleSeriesMap {
  if (import.meta.env.DEV) perf.begin("build-sample-series");
  const result: SampleSeriesMap = new Map();
  if (!Array.isArray(outputs) || outputs.length === 0 || sampleCount < 1) {
    if (import.meta.env.DEV) perf.end("build-sample-series");
    return result;
  }

  const step = sampleCount > 1 ? (endTime - startTime) / (sampleCount - 1) : 0;

  for (let channelIndex = 0; channelIndex < outputs.length; channelIndex++) {
    const channelName = outputs[channelIndex];
    if (typeof channelName !== "string" || !channelName) {
      continue;
    }

    // Reuse the same sample objects for the steady-state visualisation path.
    // This removes the dominant per-rebuild JS allocation churn without
    // changing the public shape the renderer already consumes.
    const samples = getReusableSeries(cache, channelName, sampleCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const time = startTime + sampleIndex * step;
      const value = readValue(channelIndex, sampleIndex);
      const sample = samples[sampleIndex]!;
      sample.time = time;
      sample.value = value;
    }
    result.set(channelName, samples);
  }

  if (import.meta.env.DEV) perf.end("build-sample-series");
  return result;
}

interface BufferState {
  pointer: number;
  capacity: number;
  view: Float64Array | null;
  heapBuffer: ArrayBufferLike | null;
}

interface BatchEvaluator {
  evaluate: (outputs: string[], startTime: number, endTime: number, numSamples: number) => SampleSeriesMap;
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
  release: () => void;
}

function createBatchEvaluator(
  module: EmscriptenModule,
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number
): BatchEvaluator {
  const legacyDesc = OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window;
  let legacyEval = bindOptionalCwrap(module, legacyDesc);

  const typedDesc = OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window_into;
  let typedEval = bindOptionalCwrap(module, typedDesc);

  const errorDesc = OPTIONAL_WASM_EXPORTS.useq_last_error;
  let readLastError = typedEval
    ? bindOptionalCwrap(module, errorDesc)
    : null;

  const tickProjectDesc = OPTIONAL_WASM_EXPORTS.useq_tick_and_project;
  let tickAndProjectEval = bindOptionalCwrap(module, tickProjectDesc);
  if (tickAndProjectEval && !readLastError) {
    readLastError = bindOptionalCwrap(module, errorDesc);
  }

  const bufferState: BufferState = {
    pointer: 0,
    capacity: 0,
    view: null,
    heapBuffer: null,
  };
  const sampleSeriesCache: SampleSeriesCache = {
    byOutput: new Map(),
  };

  const ensureCapacity = (requiredLength: number): BufferState => {
    const heapF64 = module.HEAPF64;
    if (!heapF64 || typeof heapF64.subarray !== "function") {
      throw new Error("uSEQ WASM module does not expose HEAPF64 for typed batch reads");
    }

    const currentHeapBuffer = heapF64.buffer ?? null;

    if (bufferState.pointer && requiredLength <= bufferState.capacity) {
      if (bufferState.view && bufferState.heapBuffer === currentHeapBuffer) {
        return bufferState;
      }

      const start = bufferState.pointer / Float64Array.BYTES_PER_ELEMENT;
      bufferState.view = heapF64.subarray(start, start + bufferState.capacity);
      bufferState.heapBuffer = currentHeapBuffer;
      return bufferState;
    }

    if (bufferState.pointer) {
      module._free(bufferState.pointer);
      bufferState.pointer = 0;
      bufferState.capacity = 0;
      bufferState.view = null;
      bufferState.heapBuffer = null;
    }

    if (requiredLength === 0) {
      return bufferState;
    }

    const bytes = requiredLength * Float64Array.BYTES_PER_ELEMENT;
    const pointer = module._malloc(bytes);
    if (!pointer) {
      throw new Error("Failed to allocate uSEQ batch buffer");
    }

    bufferState.pointer = pointer;
    bufferState.capacity = requiredLength;
    const start = pointer / Float64Array.BYTES_PER_ELEMENT;
    bufferState.view = heapF64.subarray(start, start + requiredLength);
    bufferState.heapBuffer = currentHeapBuffer;
    return bufferState;
  };

  const release = (): void => {
    if (bufferState.pointer) {
      module._free(bufferState.pointer);
      bufferState.pointer = 0;
      bufferState.capacity = 0;
      bufferState.view = null;
      bufferState.heapBuffer = null;
    }
    sampleSeriesCache.byOutput.clear();
  };

  const evaluateTyped = (outputsArray: string[], outputsJson: string, start: number, end: number, sampleCount: number): SampleSeriesMap => {
    if (!typedEval) {
      throw new Error("Typed batch evaluation is unavailable");
    }

    if (outputsArray.length === 0) {
      return new Map();
    }

    const totalEntries = outputsArray.length * sampleCount;
    const { pointer, view } = ensureCapacity(totalEntries);
    if (!view || view.length < totalEntries) {
      throw new Error("uSEQ WASM buffer view is unavailable");
    }
    let status: number;
    if (import.meta.env.DEV) perf.begin("wasm-typed-batch");
    try {
      status = typedEval(outputsJson, start, end, sampleCount, pointer, totalEntries) as number;
      if (import.meta.env.DEV) perf.end("wasm-typed-batch");
    } catch (error) {
      if (import.meta.env.DEV) perf.end("wasm-typed-batch");
      if (isBrokenOptionalExportError(error)) {
        typedEval = null;
        readLastError = null;
      }
      throw error;
    }
    if (status < 0) {
      let message = "uSEQ WASM batch evaluation failed";
      if (typeof readLastError === "function") {
        try {
          message = (readLastError() as string) || message;
        } catch (error) {
          if (isBrokenOptionalExportError(error)) {
            readLastError = null;
          }
        }
      }
      throw new Error(message || "uSEQ WASM batch evaluation failed");
    }

    dbg(`useqWasmInterpreter: typed batch returned status ${status} for ${outputsArray.length} channels x ${sampleCount} samples`);

    const validChannels = Math.min(outputsArray.length, Math.max(status, 0));
    return buildSampleSeries(outputsArray, start, end, sampleCount, (channelIndex: number, sampleIndex: number): number => {
      if (!view || channelIndex >= validChannels) {
        return Number.NaN;
      }
      const valueIndex = channelIndex * sampleCount + sampleIndex;
      if (valueIndex < 0 || valueIndex >= view.length) {
        return Number.NaN;
      }
      return view[valueIndex];
    }, sampleSeriesCache);
  };

  const evaluateLegacy = (outputsArray: string[], outputsJson: string, start: number, end: number, sampleCount: number): SampleSeriesMap => {
    if (!legacyEval) {
      throw new Error("Legacy batch evaluation is unavailable");
    }

    let resultJson: string;
    try {
      resultJson = legacyEval(outputsJson, start, end, sampleCount) as string;
    } catch (error) {
      if (isBrokenOptionalExportError(error)) {
        legacyEval = null;
      }
      throw error;
    }
    const parsed = JSON.parse(resultJson) as Record<string, number[]> | { error: string };

    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "error")) {
      throw new Error((parsed as { error: string }).error);
    }

    const channelNames = Object.keys(parsed || {});
    return buildSampleSeries(channelNames, start, end, sampleCount, (channelIndex: number, sampleIndex: number): number => {
      const values = (parsed as Record<string, number[]>)?.[channelNames[channelIndex]];
      if (!Array.isArray(values) || sampleIndex >= values.length) {
        return Number.NaN;
      }
      return values[sampleIndex];
    }, sampleSeriesCache);
  };

  const evaluateBySampling = (
    outputsArray: string[],
    start: number,
    end: number,
    sampleCount: number
  ): SampleSeriesMap =>
    buildSampleSeries(
      outputsArray,
      start,
      end,
      sampleCount,
      (channelIndex: number, sampleIndex: number): number => {
        const channelName = outputsArray[channelIndex];
        if (typeof channelName !== "string" || !channelName) {
          return Number.NaN;
        }

        const time =
          sampleCount > 1
            ? start + ((end - start) * sampleIndex) / (sampleCount - 1)
            : start;

        return evaluateOutputAtTime(channelName, time);
      },
      sampleSeriesCache,
    );

  const evaluate = (outputs: string[], startTime: number, endTime: number, numSamples: number): SampleSeriesMap => {
    const outputsArray = Array.isArray(outputs) ? Array.from(outputs) : [];
    const outputsJson = JSON.stringify(outputsArray);
    const start = Number(startTime) || 0;
    const end = Number(endTime) || 0;
    const sampleCount = clampSampleCount(numSamples);

    if (!typedEval && !legacyEval) {
      dbg("useqWasmInterpreter: batch helpers unavailable; sampling via useq_eval_output()");
      return evaluateBySampling(outputsArray, start, end, sampleCount);
    }

    if (!typedEval) {
      try {
        return evaluateLegacy(outputsArray, outputsJson, start, end, sampleCount);
      } catch (error) {
        if (!legacyEval) {
          dbg(`useqWasmInterpreter: legacy batch evaluation failed (${error instanceof Error ? error.message : String(error)}); sampling via useq_eval_output()`);
          return evaluateBySampling(outputsArray, start, end, sampleCount);
        }
        throw error;
      }
    }

    try {
      return evaluateTyped(outputsArray, outputsJson, start, end, sampleCount);
    } catch (error) {
      if (!legacyEval) {
        dbg(`useqWasmInterpreter: typed batch evaluation failed (${error instanceof Error ? error.message : String(error)}); sampling via useq_eval_output()`);
        return evaluateBySampling(outputsArray, start, end, sampleCount);
      }

      dbg(`useqWasmInterpreter: typed batch evaluation failed (${error instanceof Error ? error.message : String(error)}); falling back to JSON bridge`);
      try {
        return evaluateLegacy(outputsArray, outputsJson, start, end, sampleCount);
      } catch (legacyError) {
        if (!legacyEval) {
          dbg(`useqWasmInterpreter: legacy batch evaluation failed (${legacyError instanceof Error ? legacyError.message : String(legacyError)}); sampling via useq_eval_output()`);
          return evaluateBySampling(outputsArray, start, end, sampleCount);
        }
        throw legacyError;
      }
    }
  };

  const tickAndProject = (
    outputsArray: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ): TickAndProjectResult | null => {
    if (!tickAndProjectEval) return null;
    const safeMode = Math.max(0, Math.min(2, Math.floor(Number(projectionMode) || 0)));
    const safeFuture = (safeMode === 0 || !Number.isFinite(numFutureSamples))
      ? 0
      : Math.max(0, Math.floor(numFutureSamples));
    const safeOutputs = Array.isArray(outputsArray) ? Array.from(outputsArray) : [];
    if (safeOutputs.length === 0) {
      return {
        tickValues: new Map(),
        projectionSamples: new Map(),
      };
    }
    const outputsJson = JSON.stringify(safeOutputs);
    const totalEntries = safeOutputs.length + safeOutputs.length * safeFuture;
    const { pointer, view } = ensureCapacity(totalEntries);
    if (!view || view.length < totalEntries) {
      throw new Error("uSEQ WASM buffer view is unavailable");
    }

    let status: number;
    if (import.meta.env.DEV) perf.begin("wasm-tick-and-project");
    try {
      status = tickAndProjectEval(
        outputsJson,
        Number(tickTime) || 0,
        safeMode,
        Number(projectEnd) || 0,
        safeFuture,
        pointer,
        totalEntries,
      ) as number;
      if (import.meta.env.DEV) perf.end("wasm-tick-and-project");
    } catch (error) {
      if (import.meta.env.DEV) perf.end("wasm-tick-and-project");
      if (isBrokenOptionalExportError(error)) {
        tickAndProjectEval = null;
        return null;
      }
      throw error;
    }

    if (status < 0) {
      let message = "uSEQ WASM tick_and_project failed";
      if (typeof readLastError === "function") {
        try {
          message = (readLastError() as string) || message;
        } catch (error) {
          if (isBrokenOptionalExportError(error)) {
            readLastError = null;
          }
        }
      }
      throw new Error(message);
    }

    const validChannels = Math.min(safeOutputs.length, Math.max(status, 0));

    const tickValues = new Map<string, number>();
    for (let c = 0; c < safeOutputs.length; c++) {
      const name = safeOutputs[c];
      if (typeof name !== "string" || !name) continue;
      const value = c < validChannels ? view[c] : Number.NaN;
      tickValues.set(name, value);
    }

    // Reconstruct timestamps: the WASM side produces samples at
    // origin + step, origin + 2*step, ..., projectionEnd where
    // step = (projectionEnd - origin) / N. The caller passes origin
    // so we reconstruct the exact same timestamps here.
    const projectionSamples = new Map<string, TimeSample[]>();
    if (safeFuture > 0) {
      const projOffset = safeOutputs.length;
      const safeEnd = Number.isFinite(+projectEnd) ? +projectEnd : 0;
      const safeOrigin = Number.isFinite(+projectionOrigin) ? +projectionOrigin : 0;
      const step = (safeEnd - safeOrigin) / safeFuture;
      for (let c = 0; c < safeOutputs.length; c++) {
        const name = safeOutputs[c];
        if (typeof name !== "string" || !name) continue;
        const samples: TimeSample[] = new Array(safeFuture);
        const rowStart = projOffset + c * safeFuture;
        for (let s = 0; s < safeFuture; s++) {
          const time = safeOrigin + step * (s + 1);
          const value =
            c < validChannels && rowStart + s < view.length
              ? view[rowStart + s]
              : Number.NaN;
          samples[s] = { time, value };
        }
        projectionSamples.set(name, samples);
      }
    }

    return { tickValues, projectionSamples };
  };

  return {
    evaluate,
    tickAndProject,
    supportsTimeWindow: (): boolean => typedEval !== null || legacyEval !== null,
    supportsTickAndProject: (): boolean => tickAndProjectEval !== null,
    release,
  };
}

function loadWasmScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available"));
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  const existing = document.querySelector<HTMLScriptElement>("script[data-useq-wasm]");
  if (existing) {
    scriptLoadPromise = existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", (event) => reject((event as any)?.error ?? new Error("Failed to load uSEQ WASM")), { once: true });
        });
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(WASM_SCRIPT_URL, window.location.href).toString();
    script.async = true;
    script.dataset.useqWasm = "true";

    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      dbg("uSEQ WASM bundle loaded");
      resolve();
    }, { once: true });

    script.addEventListener("error", () => {
      scriptLoadPromise = null;
      reject(new Error("Failed to load uSEQ WASM bundle"));
    }, { once: true });

    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

async function instantiateInterpreter(): Promise<UseqRuntime> {
  await loadWasmScript();

  const factory = window.createModule;
  if (typeof factory !== "function") {
    throw new Error("uSEQ WASM bundle did not expose createModule()");
  }

  const module = await factory();

  // Validate ABI before using the module — fail fast on drift
  const abiResult: WasmAbiValidation = assertWasmAbi(module);

  if (abiResult.missingOptional.length > 0) {
    dbg(`useqWasmInterpreter: optional ABI exports not present: ${abiResult.missingOptional.join(", ")}`);
  }
  if (abiResult.presentOptional.length > 0) {
    dbg(`useqWasmInterpreter: optional ABI exports detected: ${abiResult.presentOptional.join(", ")}`);
  }

  // Bind required exports using contract descriptors
  const initDesc = REQUIRED_WASM_EXPORTS.useq_init;
  const useq_init = module.cwrap(initDesc.symbol, initDesc.returnType, initDesc.argTypes as unknown as string[]) as () => void;

  const evalDesc = REQUIRED_WASM_EXPORTS.useq_eval;
  const useq_eval = module.cwrap(evalDesc.symbol, evalDesc.returnType, evalDesc.argTypes as unknown as string[]) as (code: string) => string;

  const timeDesc = REQUIRED_WASM_EXPORTS.useq_update_time;
  const useq_update_time = module.cwrap(timeDesc.symbol, timeDesc.returnType, timeDesc.argTypes as unknown as string[]) as (t: number) => void;

  const outputDesc = REQUIRED_WASM_EXPORTS.useq_eval_output;
  const useq_eval_output = module.cwrap(outputDesc.symbol, outputDesc.returnType, outputDesc.argTypes as unknown as string[]) as (name: string, t: number) => number;
  const evaluateOutputAtTime = (name: string, timeSeconds: number): number => {
    const value = useq_eval_output(name, Number(timeSeconds) || 0);
    return Number.isNaN(value) ? NaN : value;
  };
  const batchEvaluator = createBatchEvaluator(module, evaluateOutputAtTime);

  // Bind the raw diagnostic export fns and stash them on the
  // `__useqWasmRuntime` global. The in-process port (`wasmRuntimePort.ts`,
  // readLastDiagnosticsSync / readActiveDiagnosticsSync) reads them back from
  // the global to pull structured diagnostics for inline editor squiggles.
  // wasmInterpreter.ts intentionally exposes no reader functions of its own;
  // the global is the sync seam shared by all optional WASM consumers below.
  const lastDiagsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_last_diagnostics) as (() => string) | null;
  const activeDiagsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_active_diagnostics) as (() => string) | null;

  // Bind live-edit slot ABI exports
  const setLiveInputsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_set_live_inputs) as ((json: string) => number) | null;
  const getLiveSlotsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_get_live_slots) as (() => string) | null;
  const setInputValueFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_set_input_value) as ((channel: number, value: number) => void) | null;

  // Bind state snapshot ABI export (state-sync.md §3)
  const applyStateSnapshotFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_apply_state_snapshot) as ((json: string) => number) | null;

  // Bind output classification ABI exports (visualisation.md §7.3–7.4)
  const classificationsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_output_classifications) as (() => string) | null;
  const dependenciesFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_output_dependencies) as ((idx: number) => number) | null;

  // Bind synth artefact ABI export (synth-nodes.md §7.2 / VAL-COMP-015).
  // The versioned payload is returned atomically from the exact-eval
  // Worker response through the in-process port.
  const synthArtifactsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_synth_artifacts) as (() => string) | null;

  // Bind probe slot ABI exports (probes.md §1.6 — compile-once, sample-many)
  const probeSetFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_probe_set) as ((slot: number, code: string) => number) | null;
  const probeSampleFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_probe_sample) as ((slot: number, start: number, end: number, count: number, bufPtr: number, bufCap: number) => number) | null;
  const probeFreeFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_probe_free) as ((slot: number) => void) | null;

  // Bind non-finite failure-mode ABI exports (failure-model.md §3.2)
  const setFailureModeFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_set_failure_mode) as ((mode: number) => number) | null;
  const getFailureModeFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_get_failure_mode) as (() => number) | null;

  // Probe sample buffer — reuses same pattern as the batch evaluator
  let probeBufPtr = 0;
  let probeBufCap = 0;
  let probeBufView: Float64Array | null = null;
  let probeBufHeap: ArrayBufferLike | null = null;

  const ensureProbeBuf = (count: number): { ptr: number; view: Float64Array } => {
    const heapF64 = module.HEAPF64;
    if (!heapF64) throw new Error("HEAPF64 unavailable");
    const currentHeap = heapF64.buffer ?? null;

    if (probeBufPtr && count <= probeBufCap) {
      if (probeBufView && probeBufHeap === currentHeap) {
        return { ptr: probeBufPtr, view: probeBufView };
      }
      const start = probeBufPtr / Float64Array.BYTES_PER_ELEMENT;
      probeBufView = heapF64.subarray(start, start + probeBufCap);
      probeBufHeap = currentHeap;
      return { ptr: probeBufPtr, view: probeBufView };
    }

    if (probeBufPtr) { module._free(probeBufPtr); probeBufPtr = 0; }
    const bytes = count * Float64Array.BYTES_PER_ELEMENT;
    probeBufPtr = module._malloc(bytes);
    if (!probeBufPtr) throw new Error("Failed to allocate probe sample buffer");
    probeBufCap = count;
    const start = probeBufPtr / Float64Array.BYTES_PER_ELEMENT;
    probeBufView = heapF64.subarray(start, start + count);
    probeBufHeap = currentHeap;
    return { ptr: probeBufPtr, view: probeBufView };
  };

  (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime = {
    useq_last_diagnostics: lastDiagsFn ?? undefined,
    useq_active_diagnostics: activeDiagsFn ?? undefined,
    useq_set_live_inputs: setLiveInputsFn ?? undefined,
    useq_get_live_slots: getLiveSlotsFn ?? undefined,
    useq_apply_state_snapshot: applyStateSnapshotFn ?? undefined,
    useq_set_input_value: setInputValueFn ?? undefined,
    useq_set_failure_mode: setFailureModeFn ?? undefined,
    useq_get_failure_mode: getFailureModeFn ?? undefined,
    useq_synth_artifacts: synthArtifactsFn ?? undefined,
  };

  useq_init();

  // Apply the user's configured non-finite failure policy at init so the
  // fresh engine matches the setting (the engine boots in "lkg" by default;
  // the setting may select the legacy zero-squash mode).
  if (setFailureModeFn) {
    const configuredMode = getAppSettings()?.runtime?.failureMode;
    setFailureModeFn(configuredMode === "zero" ? 1 : 0);
  }
  dbg("uSEQ WASM interpreter initialised");
  lastKnownTimeWindowSupport = batchEvaluator.supportsTimeWindow();
  lastKnownTickAndProjectSupport = batchEvaluator.supportsTickAndProject();
  lastKnownLiveInputsSupport = setLiveInputsFn !== null;
  classificationsFnStored = classificationsFn;
  dependenciesFnStored = dependenciesFn;

  return {
    module,
    evaluate: (code: string): string => {
      try {
        return useq_eval(code);
      } catch (error) {
        throw new Error(`uSEQ WASM evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    updateTime: (seconds: number): void => {
      try {
        useq_update_time(Number(seconds) || 0);
      } catch (error) {
        throw new Error(`uSEQ WASM time update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    evaluateOutputAtTime: (name: string, timeSeconds: number): number => {
      try {
        return evaluateOutputAtTime(name, timeSeconds);
      } catch (error) {
        throw new Error(`uSEQ WASM output evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    evaluateOutputsTimeWindow: (outputs: string[], startTime: number, endTime: number, numSamples: number): SampleSeriesMap => {
      try {
        const result = batchEvaluator.evaluate(outputs, startTime, endTime, numSamples);
        lastKnownTimeWindowSupport = batchEvaluator.supportsTimeWindow();
        return result;
      } catch (error) {
        lastKnownTimeWindowSupport = batchEvaluator.supportsTimeWindow();
        throw new Error(`uSEQ WASM batch evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    tickAndProjectOutputs: (
      outputs: string[],
      tickTime: number,
      projectionMode: ProjectionMode,
      projectEnd: number,
      numFutureSamples: number,
      projectionOrigin: number,
    ): TickAndProjectResult | null => {
      try {
        const result = batchEvaluator.tickAndProject(outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin);
        lastKnownTickAndProjectSupport = batchEvaluator.supportsTickAndProject();
        return result;
      } catch (error) {
        lastKnownTickAndProjectSupport = batchEvaluator.supportsTickAndProject();
        throw new Error(`uSEQ WASM tick_and_project failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    supportsTimeWindow: batchEvaluator.supportsTimeWindow(),
    supportsTickAndProject: batchEvaluator.supportsTickAndProject(),
    supportsProbeSlots: probeSetFn !== null && probeSampleFn !== null,
    probeSet: (slot: number, code: string): number => {
      if (!probeSetFn) return -1;
      return probeSetFn(slot, code) as number;
    },
    probeSample: (slot: number, start: number, end: number, count: number): Float64Array | null => {
      if (!probeSampleFn || count < 1) return null;
      const { ptr, view } = ensureProbeBuf(count);
      const written = probeSampleFn(slot, start, end, count, ptr, count) as number;
      if (written < 1) return null;
      return view.subarray(0, written);
    },
    probeFree: (slot: number): void => {
      if (probeFreeFn) probeFreeFn(slot);
    },
    release: (): void => {
      batchEvaluator.release();
      if (probeBufPtr) { module._free(probeBufPtr); probeBufPtr = 0; }
    }
  };
}

export function ensureUseqWasmLoaded(): Promise<UseqRuntime> {
  if (!runtimePromise) {
    runtimePromise = instantiateInterpreter().catch((error) => {
      scriptLoadPromise = null;
      runtimePromise = null;
      lastKnownTimeWindowSupport = false;
      lastKnownTickAndProjectSupport = false;
      console.error("Failed to load uSEQ WASM interpreter", error);
      throw error;
    });
  }
  return runtimePromise;
}

async function evalCodeInUseqWasm(
  code: string,
  options?: { publish?: boolean },
): Promise<string | null> {
  if (!isUseqWasmEnabled()) {
    return null;
  }

  const runtime = await ensureUseqWasmLoaded();
  const result = runtime.evaluate(code);

  if (options?.publish !== false) {
    try {
      codeEvaluatedChannel.publish({ code });
    } catch (error) {
      dbg(`useqWasmInterpreter: failed to publish codeEvaluated event: ${error}`);
    }
  }

  return result;
}

export async function evalInUseqWasm(code: string): Promise<string | null> {
  return evalCodeInUseqWasm(code, { publish: true });
}

export async function evalInUseqWasmSilently(
  code: string,
): Promise<string | null> {
  return evalCodeInUseqWasm(code, { publish: false });
}

export async function syncWasmTransportState(state: TransportState): Promise<string | null> {
  const command = TRANSPORT_STATE_TO_COMMAND[state];
  if (!command) {
    return null;
  }
  return evalInUseqWasm(command);
}

export async function updateUseqWasmTime(timeSeconds: number): Promise<void> {
  if (!isUseqWasmEnabled()) {
    return;
  }
  const runtime = await ensureUseqWasmLoaded();
  runtime.updateTime(timeSeconds);
}

export async function evalOutputAtTime(name: string, timeSeconds: number): Promise<number> {
  if (!isUseqWasmEnabled()) {
    return Number.NaN;
  }
  const runtime = await ensureUseqWasmLoaded();
  return runtime.evaluateOutputAtTime(name, timeSeconds);
}

/**
 * Evaluate multiple outputs across a time window
 */
export async function evalOutputsInTimeWindow(
  outputs: string[],
  startTime: number,
  endTime: number,
  numSamples: number
): Promise<SampleSeriesMap> {
  if (!isUseqWasmEnabled()) {
    return new Map();
  }

  const runtime = await ensureUseqWasmLoaded();
  const sampleMap = runtime.evaluateOutputsTimeWindow(outputs, startTime, endTime, numSamples);
  if (!(sampleMap instanceof Map)) {
    throw new Error("uSEQ WASM batch evaluation returned unexpected data");
  }
  return sampleMap;
}

/**
 * Combined tick + future projection in a single WASM boundary crossing.
 *
 * Phase 1 (state-advancing tick at `tickTime`) is identical to a
 * `evalOutputsInTimeWindow([...outputs], tickTime, tickTime, 1)` call,
 * except that it doesn't allocate a JSON intermediate or a fresh sample
 * map. Phase 2 (projection) runs with save/restore around it so live
 * state isn't corrupted.
 *
 * Returns `null` when the optional `useq_tick_and_project` export isn't
 * available — callers should fall back to the legacy 3-call path.
 *
 * See `docs/specs/visualisation.md` §5.2 / §7.2.
 */
export async function tickAndProjectOutputs(
  outputs: string[],
  tickTime: number,
  projectionMode: ProjectionMode,
  projectEnd: number,
  numFutureSamples: number,
  projectionOrigin: number,
): Promise<TickAndProjectResult | null> {
  if (!isUseqWasmEnabled()) {
    return null;
  }

  const runtime = await ensureUseqWasmLoaded();
  return runtime.tickAndProjectOutputs(outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin);
}

export async function probeSet(slot: number, code: string): Promise<number> {
  if (!isUseqWasmEnabled()) return -1;
  const runtime = await ensureUseqWasmLoaded();
  return runtime.probeSet(slot, code);
}

export async function probeSample(
  slot: number,
  startTime: number,
  endTime: number,
  count: number,
): Promise<Float64Array | null> {
  if (!isUseqWasmEnabled()) return null;
  const runtime = await ensureUseqWasmLoaded();
  return runtime.probeSample(slot, startTime, endTime, count);
}

export async function probeFree(slot: number): Promise<void> {
  if (!isUseqWasmEnabled()) return;
  const runtime = await ensureUseqWasmLoaded();
  runtime.probeFree(slot);
}

/**
 * Capability report for a WasmRuntimePort instance.
 *
 * Allows callers to discover which operations are actually available before
 * attempting them, without relying on try/catch at call sites.
 */
export interface WasmCapabilities {
  /** Whether the WASM runtime is enabled in user settings. */
  readonly enabled: boolean;
  /** Whether eval operations are available. */
  readonly supportsEval: boolean;
  /** Whether time-window batch evaluation is available. */
  readonly supportsTimeWindow: boolean;
  /** Whether the combined tick + project export is available. */
  readonly supportsTickAndProject: boolean;
}

/**
 * Typed boundary for the uSEQ WASM interpreter capabilities.
 *
 * Consumers should depend on this interface rather than importing individual
 * functions directly, so the concrete implementation can be replaced or mocked.
 */
export interface WasmRuntimePort {
  /** Report what this port can actually do at runtime. */
  capabilities(): WasmCapabilities;
  /** Evaluate uSEQ Lisp code and return the result string, or null if WASM is disabled. */
  eval(code: string): Promise<string | null>;
  /** Sync the hardware transport state to the WASM interpreter. */
  syncTransportState(state: TransportState): Promise<string | null>;
  /** Advance the WASM interpreter's internal clock. */
  updateTime(timeSeconds: number): Promise<void>;
  /** Evaluate a single named output at a given time. */
  evalOutputAtTime(name: string, timeSeconds: number): Promise<number>;
  /** Evaluate multiple outputs across a time window. */
  evalOutputsInTimeWindow(
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number
  ): Promise<SampleSeriesMap>;

  /**
   * Combined tick + future projection in a single boundary crossing.
   *
   * Returns `null` when the export isn't available — callers must fall
   * back to the legacy `evalOutputAtTime` + `evalOutputsInTimeWindow`
   * path. See `docs/specs/visualisation.md` §5.2 / §7.2.
   */
  tickAndProject(
    outputs: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ): Promise<TickAndProjectResult | null>;
}

/** Concrete WasmRuntimePort backed by the embedded WASM interpreter. */
export const wasmRuntimePort: WasmRuntimePort = {
  capabilities(): WasmCapabilities {
    const enabled = isUseqWasmEnabled();
    return {
      enabled,
      supportsEval: enabled,
      supportsTimeWindow: enabled && lastKnownTimeWindowSupport,
      supportsTickAndProject: enabled && lastKnownTickAndProjectSupport,
    };
  },
  eval: evalInUseqWasm,
  syncTransportState: syncWasmTransportState,
  updateTime: updateUseqWasmTime,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
  tickAndProject: tickAndProjectOutputs,
};

// ---------------------------------------------------------------------------
// Live-edit slot ABI bindings
// ---------------------------------------------------------------------------

/**
 * Inject live-edit slot values into the WASM interpreter.
 *
 * @param values - Record of slot id → numeric value.
 * @returns Count of successfully applied writes (0 if unavailable).
 */
export async function setLiveInputs(values: Record<string, number>): Promise<number> {
  if (!isUseqWasmEnabled()) return 0;

  // Ensure WASM is loaded (this sets up __useqWasmRuntime)
  await ensureUseqWasmLoaded();
  const global = (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime;
  if (!global?.useq_set_live_inputs) return 0;

  try {
    const json = JSON.stringify(values);
    const applied = global.useq_set_live_inputs(json);
    lastKnownLiveInputsSupport = true;
    return applied;
  } catch {
    lastKnownLiveInputsSupport = false;
    return 0;
  }
}

/**
 * Forward a single analog hardware input value to the WASM interpreter
 * via `useq_set_input_value(channel, value)`.
 *
 * Silently no-ops when the runtime is disabled, the export is missing,
 * or the underlying call throws.
 */
export async function setHwInputValue(index: number, value: number): Promise<void> {
  if (!isUseqWasmEnabled()) return;
  await ensureUseqWasmLoaded();
  const global = (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime;
  if (!global?.useq_set_input_value) return;
  try {
    global.useq_set_input_value(Number(index) | 0, Number(value) || 0);
  } catch {
    // Best-effort forward — input updates are not critical to correctness.
  }
}

/** Metadata for a live-edit slot returned from the WASM runtime. */
export interface LiveSlotMetadata {
  id: string;
  value: number;
  min: number;
  max: number;
  seed: number;
}

/**
 * Query all allocated live-edit slots from the WASM interpreter.
 *
 * @returns Array of slot metadata, or empty if unavailable.
 */
export async function getLiveSlots(): Promise<LiveSlotMetadata[]> {
  if (!isUseqWasmEnabled()) return [];

  // Ensure WASM is loaded (this sets up __useqWasmRuntime)
  await ensureUseqWasmLoaded();
  const global = (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime;
  if (!global?.useq_get_live_slots) return [];

  try {
    const json = global.useq_get_live_slots();
    if (!json) return [];
    return JSON.parse(json) as LiveSlotMetadata[];
  } catch {
    return [];
  }
}

/** Whether the live-inputs ABI is available. */
export function supportsLiveInputs(): boolean {
  return lastKnownLiveInputsSupport;
}

// ---------------------------------------------------------------------------
// Output Classification (visualisation.md §7.3–7.4)
// ---------------------------------------------------------------------------

import type { OutputClassification } from "../contracts/runtimePorts";
import { OutputClass } from "../contracts/runtimePorts";

export async function readOutputClassifications(): Promise<OutputClassification | null> {
  if (!isUseqWasmEnabled()) return null;
  await ensureUseqWasmLoaded();
  if (!classificationsFnStored) return null;

  try {
    const json = classificationsFnStored();
    if (!json) return null;
    const raw = JSON.parse(json) as number[];
    if (!Array.isArray(raw)) return null;

    const classes: OutputClass[] = raw.map((v) => {
      if (v === 1) return OutputClass.Pure;
      if (v === 2) return OutputClass.InputDep;
      if (v === 3) return OutputClass.Stateful;
      return OutputClass.Inactive;
    });

    const inputMasks: number[] = [];
    if (dependenciesFnStored) {
      for (let i = 0; i < raw.length; i++) {
        inputMasks.push(dependenciesFnStored(i));
      }
    } else {
      for (let i = 0; i < raw.length; i++) {
        inputMasks.push(0);
      }
    }

    return { classes, inputMasks };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diagnostic type — re-exported from canonical location
// ---------------------------------------------------------------------------
// The canonical definition lives in `src/contracts/runtimeTypes.ts`.
// Re-exported here for backward compatibility with existing consumers.

export type { UseqDiagnostic } from "../contracts/runtimeTypes";
