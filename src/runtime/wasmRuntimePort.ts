/**
 * WasmRuntimePort — runtime-port adapter over `wasmInterpreter.ts`.
 *
 * Thin façade. The interpreter module itself is not modified — this adapter
 * exposes its capabilities through the typed {@link WasmRuntimePort} surface
 * defined in `src/contracts/runtimePorts.ts`.
 *
 * Worker-readiness: the surface here is the natural postMessage boundary for
 * the upcoming worker move (`useq-perform-nri`):
 *
 *   - All methods are async.
 *   - All arguments and return values are structured-cloneable.
 *   - No call assumes prior shared-mutable state with another call (one-shot).
 *
 * When the worker version lands, replace the singleton below with one whose
 * methods proxy through `Worker.postMessage()` — caller code does not change.
 *
 * @see docs/RUNTIME_CONTRACT.md
 */

import type {
  SampleSeriesMap,
  WasmRuntimeCapabilities,
  WasmRuntimePort,
} from "../contracts/runtimePorts";
import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";

import {
  ensureUseqWasmLoaded,
  evalInUseqWasm,
  evalInUseqWasmSilently,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
  syncWasmTransportState,
  updateUseqWasmTime,
  wasmRuntimePort as legacyWasmRuntimePort,
} from "./wasmInterpreter.ts";

/**
 * Concrete WASM port. Backed entirely by the existing `wasmInterpreter.ts`
 * functions — this adapter exists only to re-shape the surface to match the
 * runtime-port contract.
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
    await evalInUseqWasm(command);
  },

  async syncTransportState(state: TransportState): Promise<void> {
    await syncWasmTransportState(state);
  },

  async ensureLoaded(): Promise<void> {
    await ensureUseqWasmLoaded();
  },

  evalCode(code: string): Promise<string | null> {
    return evalInUseqWasm(code);
  },

  evalCodeSilently(code: string): Promise<string | null> {
    return evalInUseqWasmSilently(code);
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
};
