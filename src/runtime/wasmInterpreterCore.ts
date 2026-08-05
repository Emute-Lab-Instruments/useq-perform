import {
  OPTIONAL_WASM_EXPORTS,
  probeOptionalWasmExport,
  type CwrapDescriptor,
} from "../contracts/wasmAbi";
import type {
  LiveSlotMetadata,
  ProjectionMode,
  TickAndProjectResult,
  TimeSample,
} from "../contracts/runtimePorts";

/** The Emscripten surface shared by the main-thread and Worker adapters. */
export interface EmscriptenModule {
  cwrap(
    symbol: string,
    returnType: string | null,
    argTypes: string[],
  ): (...args: any[]) => any;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPF64: Float64Array;
}

export type CoreLog = (message: string) => void;

export function bindOptionalCwrap(
  module: EmscriptenModule,
  descriptor: CwrapDescriptor,
  log: CoreLog = () => {},
): ((...args: any[]) => any) | null {
  if (!probeOptionalWasmExport(module, descriptor)) {
    log(`${descriptor.symbol} is not available on this WASM bundle`);
    return null;
  }

  try {
    return module.cwrap(
      descriptor.symbol,
      descriptor.returnType,
      descriptor.argTypes as unknown as string[],
    );
  } catch (error) {
    log(
      `failed to bind ${descriptor.symbol} (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
}

export function isBrokenOptionalExportError(error: unknown): boolean {
  return error instanceof Error &&
    error.name === "TypeError" &&
    /func is not a function/i.test(error.message);
}

interface HeapBuffer {
  ensure(length: number): { pointer: number; view: Float64Array };
  release(): void;
}

/**
 * Own one grow-on-demand buffer in the module heap.
 *
 * A WebAssembly memory growth replaces HEAPF64's ArrayBuffer but leaves the
 * allocation pointer valid. Rebind the view in that case; only allocate when
 * the requested capacity actually grows.
 */
export function createHeapBuffer(
  module: EmscriptenModule,
  allocationLabel: string,
): HeapBuffer {
  let pointer = 0;
  let capacity = 0;
  let view: Float64Array | null = null;
  let heapBuffer: ArrayBufferLike | null = null;

  const release = (): void => {
    if (pointer) module._free(pointer);
    pointer = 0;
    capacity = 0;
    view = null;
    heapBuffer = null;
  };

  return {
    ensure(length: number): { pointer: number; view: Float64Array } {
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(`Invalid ${allocationLabel} capacity: ${length}`);
      }
      const heap = module.HEAPF64;
      if (!heap || typeof heap.subarray !== "function") {
        throw new Error("uSEQ WASM module does not expose HEAPF64");
      }

      if (pointer && length <= capacity) {
        if (!view || heapBuffer !== heap.buffer) {
          const start = pointer / Float64Array.BYTES_PER_ELEMENT;
          view = heap.subarray(start, start + capacity);
          heapBuffer = heap.buffer;
        }
        return { pointer, view };
      }

      release();
      if (length === 0) return { pointer: 0, view: heap.subarray(0, 0) };

      pointer = module._malloc(length * Float64Array.BYTES_PER_ELEMENT);
      if (!pointer) throw new Error(`Failed to allocate ${allocationLabel}`);
      capacity = length;
      const start = pointer / Float64Array.BYTES_PER_ELEMENT;
      view = heap.subarray(start, start + capacity);
      heapBuffer = heap.buffer;
      return { pointer, view };
    },
    release,
  };
}

function clampSampleCount(value: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1
    ? Math.floor(numeric)
    : 1;
}

interface SampleSeriesCache {
  byOutput: Map<string, TimeSample[]>;
}

function getSeries(
  cache: SampleSeriesCache,
  output: string,
  sampleCount: number,
): TimeSample[] {
  const existing = cache.byOutput.get(output);
  if (existing?.length === sampleCount) return existing;

  const created = Array.from(
    { length: sampleCount },
    () => ({ time: 0, value: 0 }),
  );
  cache.byOutput.set(output, created);
  return created;
}

function buildSampleSeries(
  outputs: readonly string[],
  startTime: number,
  endTime: number,
  sampleCount: number,
  readValue: (channelIndex: number, sampleIndex: number) => number,
  cache: SampleSeriesCache,
): Map<string, TimeSample[]> {
  const result = new Map<string, TimeSample[]>();
  const step = sampleCount > 1
    ? (endTime - startTime) / (sampleCount - 1)
    : 0;

  for (let channelIndex = 0; channelIndex < outputs.length; channelIndex++) {
    const name = outputs[channelIndex];
    if (!name) continue;
    const samples = getSeries(cache, name, sampleCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const sample = samples[sampleIndex]!;
      sample.time = startTime + sampleIndex * step;
      sample.value = readValue(channelIndex, sampleIndex);
    }
    result.set(name, samples);
  }
  return result;
}

export interface WasmBatchEvaluator {
  evaluate(
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number,
  ): Map<string, TimeSample[]>;
  tickAndProject(
    outputs: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ): TickAndProjectResult | null;
  supportsTimeWindow(): boolean;
  supportsTickAndProject(): boolean;
  release(): void;
}

export function createWasmBatchEvaluator(
  module: EmscriptenModule,
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number,
  log: CoreLog = () => {},
): WasmBatchEvaluator {
  let legacyEval = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window,
    log,
  );
  let typedEval = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window_into,
    log,
  );
  let readLastError = typedEval
    ? bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_last_error, log)
    : null;
  let tickAndProjectEval = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_tick_and_project,
    log,
  );
  if (tickAndProjectEval && !readLastError) {
    readLastError = bindOptionalCwrap(
      module,
      OPTIONAL_WASM_EXPORTS.useq_last_error,
      log,
    );
  }

  const buffer = createHeapBuffer(module, "uSEQ batch buffer");
  const cache: SampleSeriesCache = { byOutput: new Map() };

  const lastErrorMessage = (fallback: string): string => {
    if (!readLastError) return fallback;
    try {
      return (readLastError() as string) || fallback;
    } catch (error) {
      if (isBrokenOptionalExportError(error)) readLastError = null;
      return fallback;
    }
  };

  const sampleIndividually = (
    outputs: string[],
    start: number,
    end: number,
    count: number,
  ): Map<string, TimeSample[]> => buildSampleSeries(
    outputs,
    start,
    end,
    count,
    (channelIndex, sampleIndex) => {
      const name = outputs[channelIndex];
      if (!name) return Number.NaN;
      const time = count > 1
        ? start + ((end - start) * sampleIndex) / (count - 1)
        : start;
      return evaluateOutputAtTime(name, time);
    },
    cache,
  );

  const evaluateLegacy = (
    outputs: string[],
    outputsJson: string,
    start: number,
    end: number,
    count: number,
  ): Map<string, TimeSample[]> => {
    if (!legacyEval) throw new Error("Legacy batch evaluation is unavailable");
    let json: string;
    try {
      json = legacyEval(outputsJson, start, end, count) as string;
    } catch (error) {
      if (isBrokenOptionalExportError(error)) legacyEval = null;
      throw error;
    }
    const parsed = JSON.parse(json) as Record<string, number[]> | { error: string };
    if (typeof parsed.error === "string") throw new Error(parsed.error);
    const valuesByName = parsed as Record<string, number[]>;
    const names = Object.keys(valuesByName);
    return buildSampleSeries(
      names,
      start,
      end,
      count,
      (channelIndex, sampleIndex) => {
        const values = valuesByName[names[channelIndex]];
        return Array.isArray(values) && sampleIndex < values.length
          ? values[sampleIndex]!
          : Number.NaN;
      },
      cache,
    );
  };

  const evaluateTyped = (
    outputs: string[],
    outputsJson: string,
    start: number,
    end: number,
    count: number,
  ): Map<string, TimeSample[]> => {
    if (!typedEval) throw new Error("Typed batch evaluation is unavailable");
    const total = outputs.length * count;
    const { pointer, view } = buffer.ensure(total);
    let status: number;
    try {
      status = typedEval(
        outputsJson,
        start,
        end,
        count,
        pointer,
        total,
      ) as number;
    } catch (error) {
      if (isBrokenOptionalExportError(error)) typedEval = null;
      throw error;
    }
    if (status < 0) {
      throw new Error(lastErrorMessage("uSEQ WASM batch evaluation failed"));
    }
    const validChannels = Math.min(outputs.length, status);
    return buildSampleSeries(
      outputs,
      start,
      end,
      count,
      (channelIndex, sampleIndex) => channelIndex < validChannels
        ? view[channelIndex * count + sampleIndex]!
        : Number.NaN,
      cache,
    );
  };

  return {
    evaluate(outputs, startTime, endTime, numSamples) {
      const safeOutputs = Array.isArray(outputs) ? Array.from(outputs) : [];
      if (safeOutputs.length === 0) return new Map();
      const start = Number(startTime) || 0;
      const end = Number(endTime) || 0;
      const count = clampSampleCount(numSamples);
      const outputsJson = JSON.stringify(safeOutputs);

      if (typedEval) {
        try {
          return evaluateTyped(safeOutputs, outputsJson, start, end, count);
        } catch (error) {
          log(`typed batch evaluation failed (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      if (legacyEval) {
        try {
          return evaluateLegacy(safeOutputs, outputsJson, start, end, count);
        } catch (error) {
          if (!isBrokenOptionalExportError(error)) throw error;
          log(`legacy batch export is broken; sampling via useq_eval_output()`);
        }
      }
      return sampleIndividually(safeOutputs, start, end, count);
    },

    tickAndProject(
      outputs,
      tickTime,
      projectionMode,
      projectEnd,
      numFutureSamples,
      projectionOrigin,
    ) {
      if (!tickAndProjectEval) return null;
      const safeMode = Math.max(
        0,
        Math.min(2, Math.floor(Number(projectionMode) || 0)),
      ) as ProjectionMode;
      const safeFuture = safeMode === 0 || !Number.isFinite(numFutureSamples)
        ? 0
        : Math.max(0, Math.floor(numFutureSamples));
      const safeOutputs = Array.isArray(outputs) ? Array.from(outputs) : [];
      if (safeOutputs.length === 0) {
        return { tickValues: new Map(), projectionSamples: new Map() };
      }

      const total = safeOutputs.length * (1 + safeFuture);
      const { pointer, view } = buffer.ensure(total);
      let status: number;
      try {
        status = tickAndProjectEval(
          JSON.stringify(safeOutputs),
          Number(tickTime) || 0,
          safeMode,
          Number(projectEnd) || 0,
          safeFuture,
          pointer,
          total,
        ) as number;
      } catch (error) {
        if (isBrokenOptionalExportError(error)) {
          tickAndProjectEval = null;
          return null;
        }
        throw error;
      }
      if (status < 0) {
        throw new Error(lastErrorMessage("uSEQ WASM tick_and_project failed"));
      }

      const validChannels = Math.min(safeOutputs.length, status);
      const tickValues = new Map<string, number>();
      for (let channel = 0; channel < safeOutputs.length; channel++) {
        const name = safeOutputs[channel];
        if (name) {
          tickValues.set(
            name,
            channel < validChannels ? view[channel]! : Number.NaN,
          );
        }
      }

      const projectionSamples = new Map<string, TimeSample[]>();
      if (safeFuture > 0) {
        const origin = Number.isFinite(projectionOrigin) ? projectionOrigin : 0;
        const end = Number.isFinite(projectEnd) ? projectEnd : 0;
        const step = (end - origin) / safeFuture;
        for (let channel = 0; channel < safeOutputs.length; channel++) {
          const name = safeOutputs[channel];
          if (!name) continue;
          const rowStart = safeOutputs.length + channel * safeFuture;
          const samples = Array.from({ length: safeFuture }, (_, index) => ({
            time: origin + step * (index + 1),
            value: channel < validChannels
              ? view[rowStart + index]!
              : Number.NaN,
          }));
          projectionSamples.set(name, samples);
        }
      }
      return { tickValues, projectionSamples };
    },

    supportsTimeWindow: () => typedEval !== null || legacyEval !== null,
    supportsTickAndProject: () => tickAndProjectEval !== null,
    release() {
      buffer.release();
      cache.byOutput.clear();
    },
  };
}

export interface WasmProbeController {
  readonly supported: boolean;
  set(slot: number, code: string): number;
  sample(
    slot: number,
    startTime: number,
    endTime: number,
    count: number,
  ): Float64Array | null;
  free(slot: number): void;
  release(): void;
}

export function createWasmProbeController(
  module: EmscriptenModule,
  log: CoreLog = () => {},
): WasmProbeController {
  const setProbe = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_probe_set,
    log,
  ) as ((slot: number, code: string) => number) | null;
  const sampleProbe = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_probe_sample,
    log,
  ) as ((slot: number, start: number, end: number, count: number, pointer: number, capacity: number) => number) | null;
  const freeProbe = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_probe_free,
    log,
  ) as ((slot: number) => void) | null;
  const buffer = createHeapBuffer(module, "uSEQ probe sample buffer");

  return {
    supported: setProbe !== null && sampleProbe !== null,
    set(slot, code) {
      if (!setProbe) return -1;
      try {
        return setProbe(slot, code);
      } catch {
        return -1;
      }
    },
    sample(slot, startTime, endTime, count) {
      if (!sampleProbe || count < 1) return null;
      try {
        const { pointer, view } = buffer.ensure(count);
        const written = sampleProbe(
          slot,
          startTime,
          endTime,
          count,
          pointer,
          count,
        );
        return written > 0 ? view.subarray(0, written) : null;
      } catch {
        return null;
      }
    },
    free(slot) {
      if (!freeProbe) return;
      try {
        freeProbe(slot);
      } catch {
        // Releasing a missing/stale optional probe is best effort.
      }
    },
    release: () => buffer.release(),
  };
}

export interface WasmLiveInputController {
  readonly supported: boolean;
  set(values: Record<string, number>): number;
  setHardwareInput(index: number, value: number): void;
  getSlots(): LiveSlotMetadata[];
  applyStateSnapshot(json: string): boolean;
}

export function createWasmLiveInputController(
  module: EmscriptenModule,
  log: CoreLog = () => {},
): WasmLiveInputController {
  const setInputs = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_set_live_inputs,
    log,
  ) as ((json: string) => number) | null;
  const setHardwareInput = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_set_input_value,
    log,
  ) as ((index: number, value: number) => void) | null;
  const getSlots = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_get_live_slots,
    log,
  ) as (() => string) | null;
  const applySnapshot = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_apply_state_snapshot,
    log,
  ) as ((json: string) => number) | null;

  return {
    supported: setInputs !== null,
    set(values) {
      if (!setInputs) return 0;
      try {
        return setInputs(JSON.stringify(values));
      } catch {
        return 0;
      }
    },
    setHardwareInput(index, value) {
      if (!setHardwareInput) return;
      try {
        setHardwareInput(Number(index) | 0, Number(value) || 0);
      } catch {
        // Hardware input forwarding is best effort.
      }
    },
    getSlots() {
      if (!getSlots) return [];
      try {
        const json = getSlots();
        return json ? JSON.parse(json) as LiveSlotMetadata[] : [];
      } catch {
        return [];
      }
    },
    applyStateSnapshot(json) {
      if (!applySnapshot) return false;
      try {
        return applySnapshot(json) === 0;
      } catch {
        return false;
      }
    },
  };
}
