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
 *   - This is a focused mirror of the eval / sample / update-time path
 *     in `src/runtime/wasmInterpreter.ts`, not a re-export of that
 *     module. Re-using the existing module would require it to load
 *     cleanly inside a worker (`document.createElement('script')`), and
 *     it is currently main-thread-shaped. Mirroring the WASM-binding
 *     surface keeps the worker file self-contained.
 *   - Diagnostics readback (`useq_last_diagnostics`,
 *     `useq_active_diagnostics`) is intentionally left to the main-side
 *     legacy path. When the worker port is enabled, the main-thread
 *     `__useqWasmRuntime` global is absent and diagnostics simply return
 *     empty arrays — a known degradation behind the experimental opt-in
 *     flag (filed as a follow-up bead).
 *   - Bytewise this duplicates ~50 lines of interpreter binding logic.
 *     Keeping the duplication local lets us iterate on the worker
 *     contract without touching the in-process port.
 */
/// <reference lib="webworker" />

import {
  assertWasmAbi,
  probeOptionalWasmExport,
  REQUIRED_WASM_EXPORTS,
  OPTIONAL_WASM_EXPORTS,
  type CwrapDescriptor,
} from "../../contracts/wasmAbi";
import { TRANSPORT_STATE_TO_COMMAND } from "../../contracts/useqRuntimeContract";
import type { TimeSample } from "../../contracts/runtimePorts";
import type {
  WasmWorkerRequest,
  WasmWorkerResponse,
  WorkerCapabilitySnapshot,
} from "./wasmRuntimeWorkerProtocol";

// ─── Emscripten module shape (worker-local) ────────────────────────────────

interface EmscriptenModule {
  cwrap(symbol: string, returnType: string | null, argTypes: string[]): (...args: any[]) => any;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPF64: Float64Array;
}

declare const self: DedicatedWorkerGlobalScope & {
  createModule?: () => Promise<EmscriptenModule>;
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
  supportsTimeWindow: () => boolean;
}

let interpreter: InterpreterHandle | null = null;

// ─── Helpers ───────────────────────────────────────────────────────────────

function postResponse(response: WasmWorkerResponse): void {
  self.postMessage(response);
}

function bindOptionalCwrap(
  module: EmscriptenModule,
  desc: CwrapDescriptor,
): ((...args: any[]) => any) | null {
  if (!probeOptionalWasmExport(module, desc)) return null;
  try {
    return module.cwrap(
      desc.symbol,
      desc.returnType,
      desc.argTypes as unknown as string[],
    );
  } catch {
    return null;
  }
}

function clampSampleCount(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
}

function buildSeries(
  outputs: string[],
  start: number,
  end: number,
  count: number,
  read: (channelIndex: number, sampleIndex: number) => number,
): Map<string, TimeSample[]> {
  const result = new Map<string, TimeSample[]>();
  if (!Array.isArray(outputs) || outputs.length === 0 || count < 1) return result;
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  for (let ci = 0; ci < outputs.length; ci++) {
    const name = outputs[ci];
    if (typeof name !== "string" || !name) continue;
    const samples: TimeSample[] = new Array(count);
    for (let si = 0; si < count; si++) {
      samples[si] = { time: start + si * step, value: read(ci, si) };
    }
    result.set(name, samples);
  }
  return result;
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
  const module = await factory();

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

  let typedEval = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window_into,
  );
  let legacyEval = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window,
  );
  let lastError = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_last_error,
  );

  // Heap-resident scratch buffer for typed batch reads (grown on demand).
  let bufferPointer = 0;
  let bufferCapacity = 0;

  const ensureBuffer = (length: number): void => {
    if (length <= bufferCapacity) return;
    if (bufferPointer) module._free(bufferPointer);
    const ptr = module._malloc(length * Float64Array.BYTES_PER_ELEMENT);
    if (!ptr) throw new Error("Failed to allocate uSEQ batch buffer in worker");
    bufferPointer = ptr;
    bufferCapacity = length;
  };

  useq_init();

  const evaluateOutputsTimeWindow = (
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number,
  ): Map<string, TimeSample[]> => {
    const sampleCount = clampSampleCount(numSamples);
    if (outputs.length === 0) return new Map();

    if (typedEval) {
      try {
        const total = outputs.length * sampleCount;
        ensureBuffer(total);
        const status = typedEval(
          JSON.stringify(outputs),
          startTime,
          endTime,
          sampleCount,
          bufferPointer,
          total,
        ) as number;
        if (status < 0) {
          let message = "uSEQ WASM batch evaluation failed";
          if (typeof lastError === "function") {
            try {
              message = (lastError() as string) || message;
            } catch {
              lastError = null;
            }
          }
          throw new Error(message);
        }
        const start = bufferPointer / Float64Array.BYTES_PER_ELEMENT;
        const view = module.HEAPF64.subarray(start, start + total);
        const valid = Math.min(outputs.length, Math.max(status, 0));
        return buildSeries(outputs, startTime, endTime, sampleCount, (ci, si) => {
          if (ci >= valid) return Number.NaN;
          const idx = ci * sampleCount + si;
          return idx < view.length ? view[idx] : Number.NaN;
        });
      } catch (error) {
        // Fall through to legacy path on any error.
        typedEval = null;
        // intentionally swallow — `legacyEval` is tried next.
        void error;
      }
    }

    if (legacyEval) {
      try {
        const json = legacyEval(
          JSON.stringify(outputs),
          startTime,
          endTime,
          sampleCount,
        ) as string;
        const parsed = JSON.parse(json) as Record<string, number[]> | { error: string };
        if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "error")) {
          throw new Error((parsed as { error: string }).error);
        }
        const names = Object.keys(parsed || {});
        return buildSeries(names, startTime, endTime, sampleCount, (ci, si) => {
          const arr = (parsed as Record<string, number[]>)[names[ci]];
          if (!Array.isArray(arr) || si >= arr.length) return Number.NaN;
          return arr[si];
        });
      } catch {
        legacyEval = null;
      }
    }

    // Final fallback: per-output sampling.
    return buildSeries(outputs, startTime, endTime, sampleCount, (ci, si) => {
      const name = outputs[ci];
      if (typeof name !== "string" || !name) return Number.NaN;
      const t =
        sampleCount > 1
          ? startTime + ((endTime - startTime) * si) / (sampleCount - 1)
          : startTime;
      const v = useq_eval_output(name, t);
      return Number.isNaN(v) ? Number.NaN : v;
    });
  };

  return {
    module,
    evaluate: (code: string): string => useq_eval(code),
    updateTime: (s: number): void => useq_update_time(Number(s) || 0),
    evaluateOutputAtTime: (name: string, t: number): number => {
      const v = useq_eval_output(name, Number(t) || 0);
      return Number.isNaN(v) ? Number.NaN : v;
    },
    evaluateOutputsTimeWindow,
    supportsTimeWindow: (): boolean => typedEval !== null || legacyEval !== null,
  };
}

// ─── Capability snapshot ───────────────────────────────────────────────────

function snapshotCapabilities(): WorkerCapabilitySnapshot {
  return {
    enabled: wasmEnabled,
    supportsEval: wasmEnabled && interpreter !== null,
    supportsTimeWindow:
      wasmEnabled && interpreter !== null && interpreter.supportsTimeWindow(),
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
      default: {
        // Exhaustiveness check.
        const _exhaustive: never = request;
        void _exhaustive;
        throw new Error(`WASM worker: unknown request type`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postResponse({ type: "error", id, message });
  }
}

self.addEventListener("message", (event: MessageEvent<WasmWorkerRequest>) => {
  const data = event.data;
  if (!data || typeof data !== "object" || typeof (data as any).id !== "number") {
    return;
  }
  void handleRequest(data);
});
