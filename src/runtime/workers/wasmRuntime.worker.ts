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
 *     `useq_active_diagnostics`) is piped across the worker boundary
 *     via the `readLastDiagnostics` / `readActiveDiagnostics` request
 *     types. The reads run inside the worker against the
 *     worker-local `__useqWasmRuntime` global so the editor's inline
 *     diagnostics and per-frame output health both keep working when
 *     the worker port is active.
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
import type {
  RuntimeDiagnostic,
  TickAndProjectResult,
  TimeSample,
} from "../../contracts/runtimePorts";
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
    projectionMode: number,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ) => TickAndProjectResult | null;
  supportsTimeWindow: () => boolean;
  supportsTickAndProject: () => boolean;
  release: () => void;
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

/**
 * Discriminate truly broken optional exports (e.g. the symbol isn't a real
 * function) from transient errors (OOM, buffer race, interpreter hiccup).
 *
 * Mirrors `isBrokenOptionalExportError` in `wasmInterpreter.ts`.
 */
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
  let tickAndProjectEval = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_tick_and_project,
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

  const releaseBuffer = (): void => {
    if (bufferPointer && module._free) {
      module._free(bufferPointer);
      bufferPointer = 0;
      bufferCapacity = 0;
    }
  };

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
  (globalThis as { __useqWasmRuntime?: UseqRuntimeGlobal }).__useqWasmRuntime = {
    useq_last_diagnostics: lastDiagsFn ?? undefined,
    useq_active_diagnostics: activeDiagsFn ?? undefined,
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
        // Only permanently disable when the export is truly broken (e.g.
        // the symbol isn't a real function). Transient errors (OOM, buffer
        // race) fall through to the legacy path without disabling the
        // fast path for future calls.
        if (isBrokenOptionalExportError(error)) {
          typedEval = null;
        }
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

  const tickAndProject = (
    outputs: string[],
    tickTime: number,
    projectionMode: number,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ): TickAndProjectResult | null => {
    if (!tickAndProjectEval) return null;
    const safeMode = Math.max(0, Math.min(2, Math.floor(Number(projectionMode) || 0)));
    const safeFuture = (safeMode === 0 || !Number.isFinite(numFutureSamples))
      ? 0
      : Math.max(0, Math.floor(numFutureSamples));
    if (outputs.length === 0) {
      return { tickValues: new Map(), projectionSamples: new Map() };
    }
    const total = outputs.length + outputs.length * safeFuture;
    ensureBuffer(total);
    let status: number;
    try {
      status = tickAndProjectEval(
        JSON.stringify(outputs),
        Number(tickTime) || 0,
        safeMode,
        Number(projectEnd) || 0,
        safeFuture,
        bufferPointer,
        total,
      ) as number;
    } catch (error) {
      if (isBrokenOptionalExportError(error)) {
        tickAndProjectEval = null;
      }
      return null;
    }
    if (status < 0) {
      let message = "uSEQ WASM tick_and_project failed";
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

    const tickValues = new Map<string, number>();
    for (let c = 0; c < outputs.length; c++) {
      const name = outputs[c];
      if (typeof name !== "string" || !name) continue;
      tickValues.set(name, c < valid ? view[c] : Number.NaN);
    }

    const projectionSamples = new Map<string, TimeSample[]>();
    if (safeFuture > 0) {
      const projOffset = outputs.length;
      const safeOrigin = Number.isFinite(+projectionOrigin) ? +projectionOrigin : 0;
      const safeEnd = Number.isFinite(+projectEnd) ? +projectEnd : 0;
      const step = (safeEnd - safeOrigin) / safeFuture;
      for (let c = 0; c < outputs.length; c++) {
        const name = outputs[c];
        if (typeof name !== "string" || !name) continue;
        const samples: TimeSample[] = new Array(safeFuture);
        const rowStart = projOffset + c * safeFuture;
        for (let s = 0; s < safeFuture; s++) {
          const time = safeOrigin + step * (s + 1);
          const value =
            c < valid && rowStart + s < view.length
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
    module,
    evaluate: (code: string): string => useq_eval(code),
    updateTime: (s: number): void => useq_update_time(Number(s) || 0),
    evaluateOutputAtTime: (name: string, t: number): number => {
      const v = useq_eval_output(name, Number(t) || 0);
      return Number.isNaN(v) ? Number.NaN : v;
    },
    evaluateOutputsTimeWindow,
    tickAndProject,
    supportsTimeWindow: (): boolean => typedEval !== null || legacyEval !== null,
    supportsTickAndProject: (): boolean => tickAndProjectEval !== null,
    release: releaseBuffer,
  };
}

// ─── Diagnostic readers (worker-local) ─────────────────────────────────────
//
// Mirror of the main-thread readers in `runtime/wasmRuntimePort.ts`. The
// Emscripten bundle running inside the worker exposes the diagnostic
// exports on the `__useqWasmRuntime` global; reading from the worker
// scope is what keeps inline editor diagnostics and per-frame output
// health alive when the worker port is the active port.

interface UseqRuntimeGlobal {
  useq_last_diagnostics?: () => string;
  useq_active_diagnostics?: () => string;
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

// ─── Capability snapshot ───────────────────────────────────────────────────

function snapshotCapabilities(): WorkerCapabilitySnapshot {
  return {
    enabled: wasmEnabled,
    supportsEval: wasmEnabled && interpreter !== null,
    supportsTimeWindow:
      wasmEnabled && interpreter !== null && interpreter.supportsTimeWindow(),
    supportsTickAndProject:
      wasmEnabled && interpreter !== null && interpreter.supportsTickAndProject(),
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
      case "tickAndProject": {
        if (!wasmEnabled || !interpreter) {
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
          request.projectionMode ?? 0,
          request.projectEnd,
          request.numFutureSamples,
          request.projectionOrigin ?? request.tickTime,
        );
        postResponse({
          type: "tickAndProject-result",
          id,
          result,
          supportsTickAndProject: interpreter.supportsTickAndProject(),
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

// Release heap-allocated buffer when the worker is closing.
self.addEventListener("close", () => {
  if (interpreter) {
    interpreter.release();
    interpreter = null;
  }
});
