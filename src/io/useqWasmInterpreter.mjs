import { dbg } from "../utils.mjs";

const WASM_SCRIPT_URL = "wasm/useq.js";
let scriptLoadPromise = null;
let runtimePromise = null;
const CODE_EVALUATED_EVENT = "useq-code-evaluated";

function tryCwrap(module, symbol, returnType, argTypes) {
  try {
    return module.cwrap(symbol, returnType, argTypes);
  } catch (error) {
    dbg(`useqWasmInterpreter: ${symbol} is not exported (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function clampSampleCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(numeric));
}

function buildSampleSeries(outputs, startTime, endTime, sampleCount, readValue) {
  const result = new Map();
  if (!Array.isArray(outputs) || outputs.length === 0 || sampleCount < 1) {
    return result;
  }

  const step = sampleCount > 1 ? (endTime - startTime) / (sampleCount - 1) : 0;

  for (let channelIndex = 0; channelIndex < outputs.length; channelIndex++) {
    const channelName = outputs[channelIndex];
    if (typeof channelName !== "string" || !channelName) {
      continue;
    }

    const samples = new Array(sampleCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const time = startTime + sampleIndex * step;
      const value = readValue(channelIndex, sampleIndex);
      samples[sampleIndex] = { time, value };
    }
    result.set(channelName, samples);
  }

  return result;
}

function createBatchEvaluator(module) {
  const legacyEval = module.cwrap("useq_eval_outputs_time_window", "string", ["string", "number", "number", "number"]);
  const typedEval = tryCwrap(module, "useq_eval_outputs_time_window_into", "number", ["string", "number", "number", "number", "number", "number"]);
  const readLastError = typedEval ? module.cwrap("useq_last_error", "string", []) : null;

  const bufferState = {
    pointer: 0,
    capacity: 0,
    view: null,
    heapBuffer: null,
  };

  const ensureCapacity = (requiredLength) => {
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

  const release = () => {
    if (bufferState.pointer) {
      module._free(bufferState.pointer);
      bufferState.pointer = 0;
      bufferState.capacity = 0;
      bufferState.view = null;
      bufferState.heapBuffer = null;
    }
  };

  const evaluateTyped = (outputsArray, outputsJson, start, end, sampleCount) => {
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
    const status = typedEval(outputsJson, start, end, sampleCount, pointer, totalEntries);
    if (status < 0) {
      const message = typeof readLastError === "function" ? readLastError() : "uSEQ WASM batch evaluation failed";
      throw new Error(message || "uSEQ WASM batch evaluation failed");
    }

    dbg(`useqWasmInterpreter: typed batch returned status ${status} for ${outputsArray.length} channels x ${sampleCount} samples`);

    const validChannels = Math.min(outputsArray.length, Math.max(status, 0));
    return buildSampleSeries(outputsArray, start, end, sampleCount, (channelIndex, sampleIndex) => {
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

  const evaluateLegacy = (outputsArray, outputsJson, start, end, sampleCount) => {
    const resultJson = legacyEval(outputsJson, start, end, sampleCount);
    const parsed = JSON.parse(resultJson);

    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "error")) {
      throw new Error(parsed.error);
    }

    const channelNames = Object.keys(parsed || {});
    return buildSampleSeries(channelNames, start, end, sampleCount, (channelIndex, sampleIndex) => {
      const values = parsed?.[channelNames[channelIndex]];
      if (!Array.isArray(values) || sampleIndex >= values.length) {
        return Number.NaN;
      }
      return values[sampleIndex];
    });
  };

  const evaluate = (outputs, startTime, endTime, numSamples) => {
    const outputsArray = Array.isArray(outputs) ? Array.from(outputs) : [];
    const outputsJson = JSON.stringify(outputsArray);
    const start = Number(startTime) || 0;
    const end = Number(endTime) || 0;
    const sampleCount = clampSampleCount(numSamples);

    if (!typedEval) {
      return evaluateLegacy(outputsArray, outputsJson, start, end, sampleCount);
    }

    try {
      return evaluateTyped(outputsArray, outputsJson, start, end, sampleCount);
    } catch (error) {
      if (!legacyEval) {
        throw error;
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

function loadWasmScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available"));
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  const existing = document.querySelector("script[data-useq-wasm]");
  if (existing) {
    scriptLoadPromise = existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", (event) => reject(event?.error ?? new Error("Failed to load uSEQ WASM")), { once: true });
        });
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
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

async function instantiateInterpreter() {
  await loadWasmScript();

  const factory = window.createModule;
  if (typeof factory !== "function") {
    throw new Error("uSEQ WASM bundle did not expose createModule()");
  }

  const module = await factory();
  const useq_init = module.cwrap("useq_init", null, []);
  const useq_eval = module.cwrap("useq_eval", "string", ["string"]);
  const useq_update_time = module.cwrap("useq_update_time", null, ["number"]);
  const useq_eval_output = module.cwrap("useq_eval_output", "number", ["string", "number"]);
  const batchEvaluator = createBatchEvaluator(module);

  useq_init();
  dbg("uSEQ WASM interpreter initialised");

  return {
    module,
    evaluate: (code) => {
      try {
        return useq_eval(code);
      } catch (error) {
        throw new Error(`uSEQ WASM evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    updateTime: (seconds) => {
      try {
        useq_update_time(Number(seconds) || 0);
      } catch (error) {
        throw new Error(`uSEQ WASM time update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    evaluateOutputAtTime: (name, timeSeconds) => {
      try {
        const value = useq_eval_output(name, Number(timeSeconds) || 0);
        return Number.isNaN(value) ? NaN : value;
      } catch (error) {
        throw new Error(`uSEQ WASM output evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    evaluateOutputsTimeWindow: (outputs, startTime, endTime, numSamples) => {
      try {
        return batchEvaluator.evaluate(outputs, startTime, endTime, numSamples);
      } catch (error) {
        throw new Error(`uSEQ WASM batch evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    release: () => {
      batchEvaluator.release();
    }
  };
}

export function ensureUseqWasmLoaded() {
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

export async function evalInUseqWasm(code) {
  const runtime = await ensureUseqWasmLoaded();
  const result = runtime.evaluate(code);

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(CODE_EVALUATED_EVENT, { detail: { code } }));
    } catch (error) {
      dbg(`useqWasmInterpreter: failed to dispatch ${CODE_EVALUATED_EVENT} event: ${error}`);
    }
  }

  return result;
}

export async function updateUseqWasmTime(timeSeconds) {
  const runtime = await ensureUseqWasmLoaded();
  runtime.updateTime(timeSeconds);
}

export async function evalOutputAtTime(name, timeSeconds) {
  const runtime = await ensureUseqWasmLoaded();
  return runtime.evaluateOutputAtTime(name, timeSeconds);
}

/**
 * Evaluate multiple outputs across a time window
 * @param {string[]} outputs - Array of output names (e.g., ["a1", "a2", "d1"])
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {number} numSamples - Number of samples to take
 * @returns {Promise<Map<string, Array<{time: number, value: number}>>>} Map of output names to time series
 */
export async function evalOutputsInTimeWindow(outputs, startTime, endTime, numSamples) {
  const runtime = await ensureUseqWasmLoaded();
  const sampleMap = runtime.evaluateOutputsTimeWindow(outputs, startTime, endTime, numSamples);
  if (!(sampleMap instanceof Map)) {
    throw new Error("uSEQ WASM batch evaluation returned unexpected data");
  }
  return sampleMap;
}
