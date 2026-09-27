/** Runtime-owned code-evaluation fan-out over the live typed ports. */

import type {
  RuntimeDiagnostic,
  RuntimeSessionSnapshot,
  SynthArtifactsPayload,
} from "../contracts/runtimeTypes.ts";
import type {
  WasmRuntimePort,
  WebSerialHostPort,
} from "../contracts/runtimePorts.ts";
import { webSerialHostPort } from "../transport/webSerialHostPort.ts";
import {
  getActiveWasmRuntimePort,
  getRuntimeSessionState,
} from "./runtimeCoordinator.ts";
import {
  supportsHardwareTransport,
  supportsWasmTransport,
} from "./runtimeSession.ts";

export interface CodeEvaluationRequest {
  /** Code as delivered to hardware, including the immediate `@` marker. */
  code: string;
  /** WASM receives the same form without the wire-only immediate marker. */
  wasmCode?: string;
  /** Soft evaluation is a browser-local preview and never reaches hardware. */
  soft?: boolean;
}

export interface HardwareCodeEvaluation {
  success: boolean;
  result: string | null;
  diagnostics: RuntimeDiagnostic[];
  error?: string;
}

export interface WasmCodeEvaluation {
  result: string | null;
  diagnostics: RuntimeDiagnostic[];
  synthArtifacts: SynthArtifactsPayload | null;
}

export type CodeEvaluationOutcome<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown };

export interface RuntimeCodeEvaluationResult {
  session: RuntimeSessionSnapshot;
  hardware: CodeEvaluationOutcome<HardwareCodeEvaluation> | null;
  wasm: CodeEvaluationOutcome<WasmCodeEvaluation> | null;
  diagnosticAuthority: "hardware" | "wasm" | null;
}

interface RuntimeCodeEvaluationDependencies {
  getSessionState: typeof getRuntimeSessionState;
  getWasmPort: () => WasmRuntimePort;
  hardwarePort: WebSerialHostPort;
}

const productionDependencies: RuntimeCodeEvaluationDependencies = {
  getSessionState: getRuntimeSessionState,
  getWasmPort: getActiveWasmRuntimePort,
  hardwarePort: webSerialHostPort,
};

async function settle<T>(operation: Promise<T>): Promise<CodeEvaluationOutcome<T>> {
  try {
    return { status: "fulfilled", value: await operation };
  } catch (error) {
    return { status: "rejected", error };
  }
}

export function createRuntimeCodeEvaluationDispatcher(
  dependencies: RuntimeCodeEvaluationDependencies,
) {
  return async function dispatchRuntimeCodeEvaluation(
    request: CodeEvaluationRequest,
  ): Promise<RuntimeCodeEvaluationResult> {
    // Resolve authority exactly once at dispatch. Later connection changes
    // affect the next evaluation, never retarget one already in flight.
    const state = dependencies.getSessionState();
    const session = { ...state.session };
    const hardwareActive = !request.soft
      && supportsHardwareTransport(session.transportMode)
      && dependencies.hardwarePort.capabilities().available;

    // Current WASM must not shadow legacy hardware for normal evals because
    // their language contracts differ. Soft preview is explicitly WASM-only
    // and remains available in that mixed development profile.
    const wasmActive = supportsWasmTransport(session.transportMode)
      && (request.soft || !hardwareActive || state.protocolMode !== "legacy");

    let wasmPort: WasmRuntimePort | null = null;
    if (wasmActive) {
      try {
        const candidate = dependencies.getWasmPort();
        if (candidate.capabilities().available) wasmPort = candidate;
      } catch {
        wasmPort = null;
      }
    }

    const hardwarePromise = hardwareActive
      ? settle(dependencies.hardwarePort.evalCodeWithDiagnostics(request.code))
      : Promise.resolve(null);
    const wasmPromise = wasmPort
      ? settle(wasmPort.evalCodeWithDiagnostics(request.wasmCode ?? request.code))
      : Promise.resolve(null);

    const [hardware, wasm] = await Promise.all([hardwarePromise, wasmPromise]);
    const diagnosticAuthority = hardware?.status === "fulfilled"
      ? "hardware"
      : wasm?.status === "fulfilled"
        ? "wasm"
        : null;

    return { session, hardware, wasm, diagnosticAuthority };
  };
}

export const dispatchRuntimeCodeEvaluation =
  createRuntimeCodeEvaluationDispatcher(productionDependencies);
