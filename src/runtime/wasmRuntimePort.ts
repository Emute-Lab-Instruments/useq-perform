/**
 * WasmRuntimePort — runtime-port adapter over `wasmInterpreter.ts`.
 *
 * Thin façade over a {@link JsonProtocolEngine}: protocol-shaped operations
 * (`sendTransportCommand`, `evalCode`, `evalCodeSilently`,
 * `syncTransportState`) flow through the same `hello` + `stream-config` +
 * `eval` JSON exchange that the hardware port does. Sampling-shaped
 * operations (`updateTime`, `evalOutputAtTime`, `evalOutputsInTimeWindow`,
 * `ensureLoaded`) stay on the direct WASM interpreter surface — they are
 * not part of the JSON protocol contract on either side and going through
 * a JSON request/response hop would only add overhead and serialise the
 * sampling hot path.
 *
 * Worker-readiness: the surface here is the natural postMessage boundary
 * for the upcoming worker move (`useq-perform-nri`):
 *
 *   - All methods are async.
 *   - All arguments and return values are structured-cloneable.
 *   - No call assumes prior shared-mutable state with another call (one-shot).
 *
 * When the worker version lands, replace the singleton below with one whose
 * methods proxy through `Worker.postMessage()` — caller code does not change.
 *
 * @see docs/specs/runtime-contract.md
 * @see src/runtime/wasmJsonTransport.ts
 */

import type {
  LiveSlotMetadata,
  OutputClassification,
  RuntimeDiagnostic,
  SampleSeriesMap,
  TickAndProjectResult,
  WasmRuntimeCapabilities,
  WasmRuntimePort,
} from "../contracts/runtimePorts";
import type { StateSnapshot } from "../contracts/runtimeTypes";
import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import { TRANSPORT_STATE_TO_COMMAND } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";

import {
  ensureUseqWasmLoaded,
  evalInUseqWasm,
  evalInUseqWasmSilently,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
  getLiveSlots as getLiveSlotsFromWasm,
  readOutputClassifications as readOutputClassificationsFromWasm,
  setHwInputValue as setHwInputValueInWasm,
  probeFree as probeFreeInWasm,
  probeSample as probeSampleInWasm,
  probeSet as probeSetInWasm,
  setLiveInputs as setLiveInputsInWasm,
  supportsLiveInputs as wasmSupportsLiveInputs,
  tickAndProjectOutputs,
  updateUseqWasmTime,
  wasmRuntimePort as legacyWasmRuntimePort,
} from "./wasmInterpreter.ts";
import { JsonProtocolEngine } from "./wasmJsonTransport.ts";
import type { WasmJsonBackend } from "./wasmJsonHandlers.ts";

/**
 * Backend wired to the in-process WASM interpreter. Each call delegates to
 * the existing `wasmInterpreter.ts` functions — the JSON layer above just
 * shapes them as request/response.
 */
const wasmJsonBackend: WasmJsonBackend = {
  evalCode: (code: string) => evalInUseqWasm(code),
  evalCodeSilently: (code: string) => evalInUseqWasmSilently(code),
};

/**
 * Singleton engine. Created lazily so test suites that don't touch the
 * WASM port don't pay any setup cost. Negotiation runs on first use.
 */
let engineInstance: JsonProtocolEngine | null = null;
function engine(): JsonProtocolEngine {
  if (!engineInstance) {
    engineInstance = new JsonProtocolEngine(wasmJsonBackend);
  }
  return engineInstance;
}

/**
 * Reset the engine. Test-only entry point; not exposed at the port
 * surface. The runtime layer never resets at runtime.
 */
export function __resetWasmJsonEngineForTests(): void {
  engineInstance = null;
}

function textFromResponse(text: string | undefined): string | null {
  return typeof text === "string" ? text : null;
}

/**
 * Concrete WASM port. The protocol-shaped methods route through the JSON
 * engine; the direct sampling methods stay on the interpreter surface
 * (see header for the rationale).
 */
export const wasmRuntimePort: WasmRuntimePort = {
  kind: "wasm-runtime",

  capabilities(): WasmRuntimeCapabilities {
    const inner = legacyWasmRuntimePort.capabilities();
    return {
      available: inner.enabled && inner.supportsEval,
      enabled: inner.enabled,
      supportsEval: inner.supportsEval,
      supportsTimeWindow: inner.supportsTimeWindow,
      supportsTickAndProject: inner.supportsTickAndProject,
      supportsLiveInputs: wasmSupportsLiveInputs(),
    };
  },

  async sendTransportCommand(command: SharedTransportCommand): Promise<void> {
    const response = await engine().sendEval(command, { silent: false });
    if (response.success === false) {
      // Surface failures the same way the hardware port would: by
      // throwing. Callers (e.g. runtimeTransportService) wrap this in
      // an Effect tryPromise so the error surfaces uniformly.
      throw new Error(response.text ?? "WASM transport command failed");
    }
  },

  async syncTransportState(state: TransportState): Promise<void> {
    const command = TRANSPORT_STATE_TO_COMMAND[state];
    if (!command) return;
    const response = await engine().sendEval(command, { silent: false });
    if (response.success === false) {
      throw new Error(response.text ?? "WASM transport state sync failed");
    }
  },

  async ensureLoaded(): Promise<void> {
    await ensureUseqWasmLoaded();
    // Drive the JSON handshake eagerly once the WASM module is loaded so
    // capability discovery runs even before the first eval. Callers can
    // still call any port method without checking — the engine guards
    // re-entry — but doing it here means diagnostics see the negotiated
    // mode immediately.
    await engine().ensureHandshake();
  },

  async evalCode(code: string): Promise<string | null> {
    const response = await engine().sendEval(code);
    if (response.success === false) {
      // Match wasmInterpreter.evalCode behaviour: throw on failure so
      // callers (editorEvaluation.ts) can render the message inline.
      throw new Error(response.text ?? "WASM eval failed");
    }
    return textFromResponse(response.text);
  },

  async evalCodeSilently(code: string): Promise<string | null> {
    const response = await engine().sendEval(code, { silent: true });
    if (response.success === false) {
      throw new Error(response.text ?? "WASM eval failed");
    }
    return textFromResponse(response.text);
  },

  async evalCodeWithDiagnostics(
    code: string,
  ): Promise<{ result: string | null; diagnostics: RuntimeDiagnostic[] }> {
    // In-process: we run on the JS main thread, so reading diagnostics
    // synchronously after sendEval resolves is sufficient — no concurrent
    // eval can run between the await and the diagnostics read.
    //
    // Unlike `evalCode`, this method never throws — the caller distinguishes
    // success from failure by inspecting `diagnostics` for severity:"error".
    // That matches the worker port and avoids losing diagnostics in a catch.
    const response = await engine().sendEval(code);
    const diagnostics = readLastDiagnosticsSync();
    const result =
      response.success === false
        ? (response.text ?? null)
        : textFromResponse(response.text);
    return { result, diagnostics };
  },

  updateTime(timeSeconds: number): Promise<void> {
    return updateUseqWasmTime(timeSeconds);
  },

  evalOutputAtTime(name: string, timeSeconds: number): Promise<number> {
    return evalOutputAtTime(name, timeSeconds);
  },

  evalOutputsInTimeWindow(
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number
  ): Promise<SampleSeriesMap> {
    return evalOutputsInTimeWindow(outputs, startTime, endTime, numSamples);
  },

  tickAndProject(
    outputs: string[],
    tickTime: number,
    projectionMode: import("../contracts/runtimePorts").ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ): Promise<TickAndProjectResult | null> {
    return tickAndProjectOutputs(outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin);
  },

  async readLastDiagnostics(): Promise<RuntimeDiagnostic[]> {
    return readLastDiagnosticsSync();
  },

  async readActiveDiagnostics(): Promise<RuntimeDiagnostic[]> {
    return readActiveDiagnosticsSync();
  },

  async setLiveInputs(values: Record<string, number>): Promise<number> {
    return setLiveInputsInWasm(values);
  },

  async setHwInputValue(index: number, value: number): Promise<void> {
    return setHwInputValueInWasm(index, value);
  },

  async probeSet(slot: number, code: string): Promise<number> {
    return probeSetInWasm(slot, code);
  },

  async probeSample(
    slot: number,
    startTime: number,
    endTime: number,
    count: number,
  ): Promise<Float64Array | null> {
    return probeSampleInWasm(slot, startTime, endTime, count);
  },

  async probeFree(slot: number): Promise<void> {
    return probeFreeInWasm(slot);
  },

  async getLiveSlots(): Promise<LiveSlotMetadata[]> {
    return getLiveSlotsFromWasm();
  },

  async applyStateSnapshot(snapshot: StateSnapshot): Promise<boolean> {
    return applyStateSnapshotSync(snapshot);
  },

  async readOutputClassifications(): Promise<OutputClassification | null> {
    return readOutputClassificationsFromWasm();
  },
};

// ---------------------------------------------------------------------------
// Diagnostic readers (in-process)
// ---------------------------------------------------------------------------
//
// These mirror the standalone helpers in `wasmInterpreter.ts` but live on the
// port so the worker port can supply its own implementation. The active-diags
// reader memoizes on the raw JSON string so per-frame polling is cheap when
// nothing has changed.

function readLastDiagnosticsSync(): RuntimeDiagnostic[] {
  try {
    const runtime = (globalThis as { __useqWasmRuntime?: { useq_last_diagnostics?: () => string } })
      .__useqWasmRuntime;
    if (!runtime?.useq_last_diagnostics) return [];
    const json = runtime.useq_last_diagnostics();
    return json ? (JSON.parse(json) as RuntimeDiagnostic[]) : [];
  } catch {
    return [];
  }
}

let _lastActiveDiagsJson = "";
let _lastActiveDiagsResult: RuntimeDiagnostic[] = [];

function readActiveDiagnosticsSync(): RuntimeDiagnostic[] {
  try {
    const runtime = (globalThis as { __useqWasmRuntime?: { useq_active_diagnostics?: () => string } })
      .__useqWasmRuntime;
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

// ---------------------------------------------------------------------------
// Non-finite failure mode (failure-model.md §3.2, settings.md)
// ---------------------------------------------------------------------------

/**
 * Push the configured non-finite failure policy to the in-process WASM
 * engine via `useq_set_failure_mode` (0 = lkg, 1 = zero). Returns `true`
 * when the export is present and the engine accepted the mode; `false`
 * when the WASM runtime is not loaded or lacks the export.
 */
export function setWasmFailureModeSync(mode: "lkg" | "zero"): boolean {
  try {
    const runtime = (globalThis as {
      __useqWasmRuntime?: { useq_set_failure_mode?: (mode: number) => number };
    }).__useqWasmRuntime;
    if (!runtime?.useq_set_failure_mode) return false;
    // The export returns the mode in effect, or -1 for an invalid argument.
    const requested = mode === "zero" ? 1 : 0;
    return runtime.useq_set_failure_mode(requested) === requested;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// State snapshot application (state-sync.md §3)
// ---------------------------------------------------------------------------

function applyStateSnapshotSync(snapshot: StateSnapshot): boolean {
  try {
    const runtime = (globalThis as {
      __useqWasmRuntime?: { useq_apply_state_snapshot?: (json: string) => number };
    }).__useqWasmRuntime;
    if (!runtime?.useq_apply_state_snapshot) return false;
    const result = runtime.useq_apply_state_snapshot(JSON.stringify(snapshot));
    return result === 0;
  } catch {
    return false;
  }
}
