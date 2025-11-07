import { dbg } from "../utils.mjs";

const WASM_SCRIPT_URL = "wasm/useq.js";
let scriptLoadPromise = null;
let runtimePromise = null;

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
  const useq_eval_outputs_time_window = module.cwrap("useq_eval_outputs_time_window", "string", ["string", "number", "number", "number"]);

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
        const outputsJson = JSON.stringify(outputs);
        const resultJson = useq_eval_outputs_time_window(
          outputsJson,
          Number(startTime) || 0,
          Number(endTime) || 0,
          Number(numSamples) || 1
        );

        const parsed = JSON.parse(resultJson);

        // Check for error response
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          throw new Error(parsed.error);
        }

        return parsed;
      } catch (error) {
        throw new Error(`uSEQ WASM batch evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
  return runtime.evaluate(code);
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

  // Get channel-series data from C++ (object with arrays)
  // Format: {"a1": [0.5, 0.6, ...], "a2": [0.3, 0.4, ...]}
  const channelData = runtime.evaluateOutputsTimeWindow(outputs, startTime, endTime, numSamples);

  // Validate channel-series format
  if (typeof channelData !== 'object' || channelData === null || Array.isArray(channelData)) {
    throw new Error('Expected channel-indexed object from WASM, got: ' + typeof channelData);
  }

  // Transform to Map with {time, value} objects for visualisationController
  // Format: Map { "a1" => [{time: 0, value: 0.5}, {time: 1, value: 0.6}], ... }
  const result = new Map();
  const timeStep = numSamples > 1 ? (endTime - startTime) / (numSamples - 1) : 0;

  for (const [outputName, valueArray] of Object.entries(channelData)) {
    if (!Array.isArray(valueArray)) {
      dbg(`Warning: Output ${outputName} is not an array, skipping`);
      continue;
    }

    // Validate array length matches expected sample count
    if (valueArray.length !== numSamples) {
      dbg(`Warning: Output ${outputName} has ${valueArray.length} samples, expected ${numSamples}`);
    }

    // Convert raw values to {time, value} objects
    const samples = valueArray.map((value, idx) => ({
      time: startTime + (idx * timeStep),
      value: value
    }));

    result.set(outputName, samples);
  }

  return result;
}
