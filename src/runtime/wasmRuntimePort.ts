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
 * @see docs/RUNTIME_CONTRACT.md
 * @see src/runtime/wasmJsonTransport.ts
 */

import type {
  RuntimeDiagnostic,
  SampleSeriesMap,
  WasmRuntimeCapabilities,
  WasmRuntimePort,
} from "../contracts/runtimePorts";
import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import { TRANSPORT_STATE_TO_COMMAND } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";

import {
  ensureUseqWasmLoaded,
  evalInUseqWasm,
  evalInUseqWasmSilently,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
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

  async readLastDiagnostics(): Promise<RuntimeDiagnostic[]> {
    return readLastDiagnosticsSync();
  },

  async readActiveDiagnostics(): Promise<RuntimeDiagnostic[]> {
    return readActiveDiagnosticsSync();
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
