import { dbg } from "../utils.ts";
import { getAppSettings } from "../../runtime/appSettingsRepository.ts";
import { TRANSPORT_STATE_TO_COMMAND } from "../../contracts/useqRuntimeContract";
import {
  CODE_EVALUATED_EVENT,
  dispatchRuntimeEvent,
} from "../../contracts/runtimeEvents";
import {
  assertWasmAbi,
  REQUIRED_WASM_EXPORTS,
  OPTIONAL_WASM_EXPORTS,
  type WasmAbiValidation,
} from "../../contracts/wasmAbi";

/** Time-series sample point */
export interface TimeSample {
  time: number;
  value: number;
}

/** Map of channel name to sample series */
export type SampleSeriesMap = Map<string, TimeSample[]>;

/** Transport states the WASM interpreter understands */
export type TransportState = 'playing' | 'paused' | 'stopped';

// Emscripten module interface (minimal typing for what we use)
interface EmscriptenModule {
  cwrap(symbol: string, returnType: string | null, argTypes: string[]): (...args: any[]) => any;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPF64: Float64Array;
}

/** Runtime interface for the instantiated WASM interpreter */
interface UseqRuntime {
  module: EmscriptenModule;
  evaluate: (code: string) => string;
  updateTime: (seconds: number) => void;
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number;
  evaluateOutputsTimeWindow: (outputs: string[], startTime: number, endTime: number, numSamples: number) => SampleSeriesMap;
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
function isUseqWasmEnabled(): boolean {
  try {
    return getAppSettings()?.wasm?.enabled ?? true;
  } catch (_e) {
    return true;
  }
}

function tryCwrap(
  module: EmscriptenModule,
  symbol: string,
  returnType: string,
  argTypes: string[]
): ((...args: any[]) => any) | null {
  try {
    return module.cwrap(symbol, returnType, argTypes);
  } catch (error) {
    dbg(`useqWasmInterpreter: ${symbol} is not exported (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function clampSampleCount(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(numeric));
}

type ReadValueFn = (channelIndex: number, sampleIndex: number) => number;

function buildSampleSeries(
  outputs: string[],
  startTime: number,
  endTime: number,
  sampleCount: number,
  readValue: ReadValueFn
): SampleSeriesMap {
  const result: SampleSeriesMap = new Map();
  if (!Array.isArray(outputs) || outputs.length === 0 || sampleCount < 1) {
    return result;
  }

  const step = sampleCount > 1 ? (endTime - startTime) / (sampleCount - 1) : 0;

  for (let channelIndex = 0; channelIndex < outputs.length; channelIndex++) {
    const channelName = outputs[channelIndex];
    if (typeof channelName !== "string" || !channelName) {
      continue;
    }

    const samples = new Array<TimeSample>(sampleCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const time = startTime + sampleIndex * step;
      const value = readValue(channelIndex, sampleIndex);
      samples[sampleIndex] = { time, value };
    }
    result.set(channelName, samples);
  }

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
  release: () => void;
}

function createBatchEvaluator(
  module: EmscriptenModule,
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number
): BatchEvaluator {
  const legacyDesc = OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window;
  const legacyEval = tryCwrap(module, legacyDesc.symbol, legacyDesc.returnType as string, legacyDesc.argTypes as unknown as string[]);

  const typedDesc = OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window_into;
  const typedEval = tryCwrap(module, typedDesc.symbol, typedDesc.returnType as string, typedDesc.argTypes as unknown as string[]);

  const errorDesc = OPTIONAL_WASM_EXPORTS.useq_last_error;
  const readLastError = typedEval
    ? tryCwrap(module, errorDesc.symbol, errorDesc.returnType as string, errorDesc.argTypes as unknown as string[])
    : null;

  const bufferState: BufferState = {
    pointer: 0,
    capacity: 0,
    view: null,
    heapBuffer: null,
  };

  const ensureCapacity = (requiredLength: number): BufferState => {
    const currentHeapBuffer = module.HEAPF64?.buffer ?? null;

    if (bufferState.pointer && requiredLength <= bufferState.capacity) {
      if (bufferState.view && bufferState.heapBuffer === currentHeapBuffer) {
        return bufferState;
      }

      const start = bufferState.pointer / Float64Array.BYTES_PER_ELEMENT;
      bufferState.view = module.HEAPF64.subarray(start, start + bufferState.capacity);
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
    bufferState.view = module.HEAPF64.subarray(start, start + requiredLength);
    bufferState.heapBuffer = module.HEAPF64?.buffer ?? null;
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
    const status = typedEval(outputsJson, start, end, sampleCount, pointer, totalEntries) as number;
    if (status < 0) {
      const message = typeof readLastError === "function" ? readLastError() as string : "uSEQ WASM batch evaluation failed";
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
    });
  };

  const evaluateLegacy = (outputsArray: string[], outputsJson: string, start: number, end: number, sampleCount: number): SampleSeriesMap => {
    if (!legacyEval) {
      throw new Error("Legacy batch evaluation is unavailable");
    }

    const resultJson = legacyEval(outputsJson, start, end, sampleCount) as string;
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
    });
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
      }
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
      return evaluateLegacy(outputsArray, outputsJson, start, end, sampleCount);
    }

    try {
      return evaluateTyped(outputsArray, outputsJson, start, end, sampleCount);
    } catch (error) {
      if (!legacyEval) {
        dbg(`useqWasmInterpreter: typed batch evaluation failed (${error instanceof Error ? error.message : String(error)}); sampling via useq_eval_output()`);
        return evaluateBySampling(outputsArray, start, end, sampleCount);
      }

      dbg(`useqWasmInterpreter: typed batch evaluation failed (${error instanceof Error ? error.message : String(error)}); falling back to JSON bridge`);
      return evaluateLegacy(outputsArray, outputsJson, start, end, sampleCount);
    }
  };

  return {
    evaluate,
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

  useq_init();
  dbg("uSEQ WASM interpreter initialised");

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
        return batchEvaluator.evaluate(outputs, startTime, endTime, numSamples);
      } catch (error) {
        throw new Error(`uSEQ WASM batch evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    release: (): void => {
      batchEvaluator.release();
    }
  };
}

export function ensureUseqWasmLoaded(): Promise<UseqRuntime> {
  if (!runtimePromise) {
    runtimePromise = instantiateInterpreter().catch((error) => {
      scriptLoadPromise = null;
      runtimePromise = null;
      console.error("Failed to load uSEQ WASM interpreter", error);
      throw error;
    });
  }
  return runtimePromise;
}

export async function evalInUseqWasm(code: string): Promise<string | null> {
  if (!isUseqWasmEnabled()) {
    return null;
  }

  const runtime = await ensureUseqWasmLoaded();
  const result = runtime.evaluate(code);

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code });
    } catch (error) {
      dbg(`useqWasmInterpreter: failed to dispatch ${CODE_EVALUATED_EVENT} event: ${error}`);
    }
  }

  return result;
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
}

/** Concrete WasmRuntimePort backed by the embedded WASM interpreter. */
export const wasmRuntimePort: WasmRuntimePort = {
  capabilities(): WasmCapabilities {
    const enabled = isUseqWasmEnabled();
    return { enabled, supportsEval: enabled, supportsTimeWindow: enabled };
  },
  eval: evalInUseqWasm,
  syncTransportState: syncWasmTransportState,
  updateTime: updateUseqWasmTime,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
};
