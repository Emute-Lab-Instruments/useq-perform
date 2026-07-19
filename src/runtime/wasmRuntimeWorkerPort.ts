/**
 * Worker-backed `WasmRuntimePort` adapter — the default port.
 *
 * Mirrors the surface of `wasmRuntimePort.ts` (the in-process fallback)
 * but routes every method through `postMessage()` to a dedicated Web
 * Worker that hosts the WASM interpreter. This keeps WASM eval, batch
 * sampling, and time updates off the main thread so the editor + UI keep
 * their frame budget.
 *
 * Bootstrap chooses this port whenever `Worker` is available
 * (`bootstrap.ts`); the in-process port remains as a fallback for
 * environments without Web Workers and as the surface tests mock against.
 *
 * Worker readiness contract (from `src/contracts/runtimePorts.ts`):
 *
 *   - All methods are async, all arguments are structured-cloneable.
 *   - Each call is a one-shot request/response with a fresh numeric id.
 *   - A `Map<id, { resolve, reject }>` tracks in-flight requests.
 *   - `ensureLoaded()` is the bootstrap handshake (one-shot, idempotent).
 *
 * Diagnostics readback (`useq_last_diagnostics`, `useq_active_diagnostics`)
 * is piped across the worker boundary via the `readLastDiagnostics` /
 * `readActiveDiagnostics` request types — the worker reads
 * `__useqWasmRuntime` in its own scope and returns the parsed diagnostic
 * array. This keeps inline editor squiggles and per-frame output health
 * working with the worker port.
 */

import { dbg } from "../lib/debug.ts";
import type {
  LiveSlotMetadata,
  RuntimeDiagnostic,
  SampleSeriesMap,
  TickAndProjectResult,
  WasmRuntimeCapabilities,
  WasmRuntimePort,
} from "../contracts/runtimePorts";
import type { StateSnapshot } from "../contracts/runtimeTypes";
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
    supportsTickAndProject: false,
    supportsLiveInputs: false,
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
        supportsTickAndProject:
          enabled && lastKnownCapabilities.supportsTickAndProject,
        supportsLiveInputs:
          enabled && lastKnownCapabilities.supportsLiveInputs === true,
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

    async evalCodeWithDiagnostics(
      code: string,
    ): Promise<{
      result: string | null;
      diagnostics: RuntimeDiagnostic[];
      synthArtifacts: import("../contracts/runtimeTypes").SynthArtifactsPayload | null;
    }> {
      if (!isUseqWasmEnabled()) return { result: null, diagnostics: [], synthArtifacts: null };
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "evalCodeWithDiagnostics-result" }>
      >(
        { type: "evalCodeWithDiagnostics", code, publish: true },
        "evalCodeWithDiagnostics-result",
      );
      try {
        codeEvaluatedChannel.publish({ code });
      } catch (error) {
        dbg(`wasmRuntimeWorkerPort: failed to publish codeEvaluated: ${error}`);
      }
      return {
        result: response.result,
        diagnostics: response.diagnostics,
        synthArtifacts: response.synthArtifacts,
      };
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

    async tickAndProject(
      outputs: string[],
      tickTime: number,
      projectionMode: import("../contracts/runtimePorts").ProjectionMode,
      projectEnd: number,
      numFutureSamples: number,
      projectionOrigin: number,
    ): Promise<TickAndProjectResult | null> {
      if (!isUseqWasmEnabled()) return null;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "tickAndProject-result" }>
      >(
        { type: "tickAndProject", outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin },
        "tickAndProject-result",
      );
      lastKnownCapabilities = {
        ...lastKnownCapabilities,
        supportsTickAndProject: response.supportsTickAndProject,
      };
      return response.result;
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

    async readLastDiagnostics(): Promise<RuntimeDiagnostic[]> {
      if (!isUseqWasmEnabled()) return [];
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "readLastDiagnostics-result" }>
      >(
        { type: "readLastDiagnostics" },
        "readLastDiagnostics-result",
      );
      return response.diagnostics;
    },

    async readActiveDiagnostics(): Promise<RuntimeDiagnostic[]> {
      if (!isUseqWasmEnabled()) return [];
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "readActiveDiagnostics-result" }>
      >(
        { type: "readActiveDiagnostics" },
        "readActiveDiagnostics-result",
      );
      return response.diagnostics;
    },

    async setLiveInputs(values: Record<string, number>): Promise<number> {
      if (!isUseqWasmEnabled()) return 0;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "setLiveInputs-result" }>
      >(
        { type: "setLiveInputs", values },
        "setLiveInputs-result",
      );
      return response.applied;
    },

    async setHwInputValue(index: number, value: number): Promise<void> {
      if (!isUseqWasmEnabled()) return;
      await ensureLoadedInternal();
      await send<
        Extract<WasmWorkerResponse, { type: "setHwInputValue-result" }>
      >(
        { type: "setHwInputValue", index, value },
        "setHwInputValue-result",
      );
    },

    async probeSet(slot: number, code: string): Promise<number> {
      if (!isUseqWasmEnabled()) return -1;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "probeSet-result" }>
      >(
        { type: "probeSet", slot, code },
        "probeSet-result",
      );
      return response.status;
    },

    async probeSample(
      slot: number,
      startTime: number,
      endTime: number,
      count: number,
    ): Promise<Float64Array | null> {
      if (!isUseqWasmEnabled()) return null;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "probeSample-result" }>
      >(
        { type: "probeSample", slot, startTime, endTime, count },
        "probeSample-result",
      );
      return response.samples ? Float64Array.from(response.samples) : null;
    },

    async probeFree(slot: number): Promise<void> {
      if (!isUseqWasmEnabled()) return;
      await ensureLoadedInternal();
      await send<
        Extract<WasmWorkerResponse, { type: "probeFree-result" }>
      >(
        { type: "probeFree", slot },
        "probeFree-result",
      );
    },

    async getLiveSlots(): Promise<LiveSlotMetadata[]> {
      if (!isUseqWasmEnabled()) return [];
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "getLiveSlots-result" }>
      >(
        { type: "getLiveSlots" },
        "getLiveSlots-result",
      );
      return response.slots;
    },

    async applyStateSnapshot(snapshot: StateSnapshot): Promise<boolean> {
      if (!isUseqWasmEnabled()) return false;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "applyStateSnapshot-result" }>
      >(
        { type: "applyStateSnapshot", snapshot },
        "applyStateSnapshot-result",
      );
      return response.success;
    },

    async readOutputClassifications(): Promise<import("../contracts/runtimePorts").OutputClassification | null> {
      // Worker port: not yet wired through the worker protocol.
      // Falls back to null (conservative invalidation) until the worker
      // protocol is extended.
      return null;
    },

    async producerInstallSab(
      controlBuffer: SharedArrayBuffer,
      options: {
        blockRateChannels: readonly string[];
        lookaheadBlocks?: number;
        renderQuantumFrames?: number;
      },
    ): Promise<boolean> {
      if (!isUseqWasmEnabled()) return false;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerInstallSab-result" }>
      >(
        {
          type: "producerInstallSab",
          controlBuffer,
          blockRateChannels: options.blockRateChannels,
          lookaheadBlocks: options.lookaheadBlocks,
          renderQuantumFrames: options.renderQuantumFrames,
        },
        "producerInstallSab-result",
      );
      // Transfer the SAB backing buffer so the Worker shares storage.
      // Note: SharedArrayBuffer is shared by default, no transfer list
      // is required (and postMessage with a SAB does not detach).
      void controlBuffer;
      return response.installed;
    },

    async producerStart(options: {
      anchorFrame?: bigint;
      anchorTime?: number;
      sampleRate: number;
    }): Promise<boolean> {
      if (!isUseqWasmEnabled()) return false;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerStart-result" }>
      >(
        {
          type: "producerStart",
          anchorFrame: options.anchorFrame,
          anchorTime: options.anchorTime,
          sampleRate: options.sampleRate,
        },
        "producerStart-result",
      );
      return response.started;
    },

    async producerStop(): Promise<boolean> {
      if (!isUseqWasmEnabled()) return false;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerStop-result" }>
      >(
        { type: "producerStop" },
        "producerStop-result",
      );
      return response.stopped;
    },

    async producerTransportUpdate(options: {
      transition: "start" | "pause" | "resume" | "stop" | "reanchor";
      atFrame: bigint;
      atTime?: number;
    }): Promise<number> {
      if (!isUseqWasmEnabled()) return 0;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerTransportUpdate-result" }>
      >(
        {
          type: "producerTransportUpdate",
          transition: options.transition,
          atFrame: options.atFrame,
          atTime: options.atTime,
        },
        "producerTransportUpdate-result",
      );
      return response.revision;
    },

    async producerApplyInputs(inputs: Record<string, number>): Promise<number> {
      if (!isUseqWasmEnabled()) return 0;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerApplyInputs-result" }>
      >(
        { type: "producerApplyInputs", inputs },
        "producerApplyInputs-result",
      );
      return response.queued;
    },

    async producerArmEpoch(epoch: number): Promise<number> {
      if (!isUseqWasmEnabled()) return 0;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerArmEpoch-result" }>
      >(
        { type: "producerArmEpoch", epoch },
        "producerArmEpoch-result",
      );
      return response.armedEpoch;
    },

    async producerTerminate(): Promise<boolean> {
      if (!isUseqWasmEnabled()) return false;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerTerminate-result" }>
      >(
        { type: "producerTerminate" },
        "producerTerminate-result",
      );
      return response.terminated;
    },

    async producerReadTelemetry(): Promise<
      import("./workers/wasmRuntimeWorkerProtocol").ProducerTelemetrySnapshot | null
    > {
      if (!isUseqWasmEnabled()) return null;
      await ensureLoadedInternal();
      const response = await send<
        Extract<WasmWorkerResponse, { type: "producerReadTelemetry-result" }>
      >(
        { type: "producerReadTelemetry" },
        "producerReadTelemetry-result",
      );
      return response.telemetry;
    },
  };
}
