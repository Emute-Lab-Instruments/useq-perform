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
