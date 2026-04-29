/**
 * Worker-backed `WasmRuntimePort` adapter.
 *
 * Mirrors the surface of `wasmRuntimePort.ts` (the in-process port) but
 * routes every method through `postMessage()` to a dedicated Web Worker
 * that hosts the WASM interpreter. This keeps WASM eval, batch sampling,
 * and time updates off the main thread so the editor + UI keep their
 * frame budget.
 *
 * Opt-in only — the bootstrap selects between the in-process port and
 * this worker port based on the `?wasmInWorker=true` URL flag. When the
 * flag is off this module is never instantiated.
 *
 * Worker readiness contract (from `src/contracts/runtimePorts.ts`):
 *
 *   - All methods are async, all arguments are structured-cloneable.
 *   - Each call is a one-shot request/response with a fresh numeric id.
 *   - A `Map<id, { resolve, reject }>` tracks in-flight requests.
 *   - `ensureLoaded()` is the bootstrap handshake (one-shot, idempotent).
 *
 * Known limitations behind the flag:
 *
 *   - Diagnostics readback (`useq_last_diagnostics`,
 *     `useq_active_diagnostics`) is not piped across the worker boundary
 *     in this iteration; the main-thread `__useqWasmRuntime` global is
 *     absent so those readers return empty arrays. Filed as a follow-up.
 *   - The probe sampler (`ProbeConfig.evalExpressionAtTimes`) still uses
 *     the in-process WASM directly. Migrating it is a separate bead.
 */

import { dbg } from "../lib/debug.ts";
import type {
  SampleSeriesMap,
  WasmRuntimeCapabilities,
  WasmRuntimePort,
} from "../contracts/runtimePorts";
import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";
import { codeEvaluated as codeEvaluatedChannel } from "../contracts/runtimeChannels";
import { getAppSettings } from "./appSettingsRepository.ts";
import type {
  WasmWorkerRequest,
  WasmWorkerResponse,
  WorkerCapabilitySnapshot,
} from "./workers/wasmRuntimeWorkerProtocol";

const WASM_SCRIPT_URL = "wasm/useq.js";

interface PendingRequest {
  resolve: (response: WasmWorkerResponse) => void;
  reject: (error: Error) => void;
}

function isUseqWasmEnabled(): boolean {
  try {
    return getAppSettings()?.wasm?.enabled ?? true;
  } catch {
    return true;
  }
}

/**
 * Construct the worker-backed WASM runtime port.
 *
 * The factory shape (rather than a top-level singleton) keeps the worker
 * spawn lazy: callers that don't enable the flag never construct a Worker.
 */
export function createWasmRuntimeWorkerPort(): WasmRuntimePort {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  let loadPromise: Promise<void> | null = null;
  let lastKnownCapabilities: WorkerCapabilitySnapshot = {
    enabled: true,
    supportsEval: false,
    supportsTimeWindow: false,
  };

  function ensureWorker(): Worker {
    if (worker) return worker;
    // Vite resolves this URL at build time; the chunk gets emitted as a
    // worker bundle. The `import.meta.url` form is the documented Vite
    // pattern (https://vitejs.dev/guide/features.html#web-workers).
    //
    // Classic worker (the default) — required because the worker calls
    // `self.importScripts()` to load the Emscripten-generated `useq.js`
    // bundle, which is a UMD-style classic script that exposes
    // `globalThis.createModule`. Module workers do not support
    // `importScripts`; switching to ESM would require an ESM-shaped
    // WASM bootstrap, which is a separate concern.
    worker = new Worker(
      new URL("./workers/wasmRuntime.worker.ts", import.meta.url),
      { name: "useq-wasm-runtime" },
    );
    worker.addEventListener("message", (event: MessageEvent<WasmWorkerResponse>) => {
      const data = event.data;
      if (!data || typeof data !== "object" || typeof (data as any).id !== "number") {
        return;
      }
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.type === "error") {
        entry.reject(new Error(data.message));
      } else {
        entry.resolve(data);
      }
    });
    worker.addEventListener("error", (event) => {
      dbg(`wasmRuntimeWorkerPort: worker error: ${event.message}`);
      // Reject all in-flight requests so callers don't hang indefinitely.
      for (const [, entry] of pending) {
        entry.reject(new Error(event.message || "WASM worker crashed"));
      }
      pending.clear();
    });
    return worker;
  }

  /**
   * Distributive `Omit` so the union members keep their own shape after
   * removing `id`. A plain `Omit<WasmWorkerRequest, "id">` collapses to
   * the intersection of all variants, which TypeScript then rejects.
   */
  type RequestWithoutId = WasmWorkerRequest extends infer R
    ? R extends { id: number }
      ? Omit<R, "id">
      : never
    : never;

  function send<T extends WasmWorkerResponse>(
    request: RequestWithoutId,
    expectType: T["type"],
  ): Promise<T> {
    const id = nextId++;
    const w = ensureWorker();
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (response) => {
          if (response.type !== expectType) {
            reject(
              new Error(
                `wasmRuntimeWorkerPort: expected ${expectType}, got ${response.type}`,
              ),
            );
            return;
          }
          resolve(response as T);
        },
        reject,
      });
      w.postMessage({ ...(request as object), id } as WasmWorkerRequest);
    });
  }

  async function ensureLoadedInternal(): Promise<void> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const url =
        typeof window !== "undefined"
          ? new URL(WASM_SCRIPT_URL, window.location.href).toString()
          : WASM_SCRIPT_URL;
      const response = await send<
        Extract<WasmWorkerResponse, { type: "load-result" }>
      >(
        {
          type: "load",
          scriptUrl: url,
          enabled: isUseqWasmEnabled(),
        },
        "load-result",
      );
      lastKnownCapabilities = response.capabilities;
      dbg(
        `wasmRuntimeWorkerPort: worker loaded; supportsEval=${response.capabilities.supportsEval} supportsTimeWindow=${response.capabilities.supportsTimeWindow}`,
      );
    })().catch((error) => {
      // Reset so a later caller can retry after a transient failure.
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  return {
    kind: "wasm-runtime",

    capabilities(): WasmRuntimeCapabilities {
      const enabled = isUseqWasmEnabled();
      return {
        available: enabled && lastKnownCapabilities.supportsEval,
        enabled,
        supportsEval: enabled && lastKnownCapabilities.supportsEval,
        supportsTimeWindow: enabled && lastKnownCapabilities.supportsTimeWindow,
      };
    },

    async ensureLoaded(): Promise<void> {
      await ensureLoadedInternal();
    },

    async evalCode(code: string): Promise<string | null> {
      if (!isUseqWasmEnabled()) return null;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "evalCode-result" }>
      >(
        { type: "evalCode", code, publish: true },
        "evalCode-result",
      );
      try {
        codeEvaluatedChannel.publish({ code });
      } catch (error) {
        dbg(`wasmRuntimeWorkerPort: failed to publish codeEvaluated: ${error}`);
      }
      return response.result;
    },

    async evalCodeSilently(code: string): Promise<string | null> {
      if (!isUseqWasmEnabled()) return null;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "evalCode-result" }>
      >(
        { type: "evalCode", code, publish: false },
        "evalCode-result",
      );
      return response.result;
    },

    async updateTime(timeSeconds: number): Promise<void> {
      if (!isUseqWasmEnabled()) return;
      await ensureLoadedInternal();
      await send<Extract<WasmWorkerResponse, { type: "updateTime-result" }>>(
        { type: "updateTime", timeSeconds },
        "updateTime-result",
      );
    },

    async evalOutputAtTime(name: string, timeSeconds: number): Promise<number> {
      if (!isUseqWasmEnabled()) return Number.NaN;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "evalOutputAtTime-result" }>
      >(
        { type: "evalOutputAtTime", name, timeSeconds },
        "evalOutputAtTime-result",
      );
      return response.value;
    },

    async evalOutputsInTimeWindow(
      outputs: string[],
      startTime: number,
      endTime: number,
      numSamples: number,
    ): Promise<SampleSeriesMap> {
      if (!isUseqWasmEnabled()) return new Map();
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "evalOutputsInTimeWindow-result" }>
      >(
        { type: "evalOutputsInTimeWindow", outputs, startTime, endTime, numSamples },
        "evalOutputsInTimeWindow-result",
      );
      lastKnownCapabilities = {
        ...lastKnownCapabilities,
        supportsTimeWindow: response.supportsTimeWindow,
      };
      return response.samples;
    },

    async sendTransportCommand(command: SharedTransportCommand): Promise<void> {
      if (!isUseqWasmEnabled()) return;
      await ensureLoadedInternal();
      await send<Extract<WasmWorkerResponse, { type: "sendTransportCommand-result" }>>(
        { type: "sendTransportCommand", command },
        "sendTransportCommand-result",
      );
    },

    async syncTransportState(state: TransportState): Promise<void> {
      if (!isUseqWasmEnabled()) return;
      await ensureLoadedInternal();
      await send<Extract<WasmWorkerResponse, { type: "syncTransportState-result" }>>(
        { type: "syncTransportState", state },
        "syncTransportState-result",
      );
    },
  };
}
