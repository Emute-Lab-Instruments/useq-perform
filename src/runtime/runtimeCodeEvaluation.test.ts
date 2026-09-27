import { describe, expect, it, vi } from "vitest";
import type {
  WasmRuntimePort,
  WebSerialHostPort,
} from "../contracts/runtimePorts.ts";
import type { TransportMode } from "../contracts/runtimeTypes.ts";
import { createRuntimeCodeEvaluationDispatcher } from "./runtimeCodeEvaluation.ts";

function runtimeState(mode: TransportMode, protocolMode: "legacy" | "json" = "json") {
  const hasHardwareConnection = mode === "hardware" || mode === "both";
  const wasmEnabled = mode === "wasm" || mode === "both";
  return {
    connected: hasHardwareConnection,
    protocolMode,
    session: {
      hasHardwareConnection,
      noModuleMode: false,
      wasmEnabled,
      connectionMode: hasHardwareConnection ? "hardware" as const : wasmEnabled ? "browser" as const : "none" as const,
      transportMode: mode,
    },
  };
}

function ports() {
  const hardwareEval = vi.fn(async () => ({
    success: true,
    result: "hardware",
    diagnostics: [{ start: 0, end: 1, severity: "warning" as const, message: "hardware" }],
  }));
  const wasmEval = vi.fn(async () => ({
    result: "wasm",
    diagnostics: [{ start: 0, end: 1, severity: "warning" as const, message: "wasm" }],
    synthArtifacts: null,
  }));
  const hardware = {
    capabilities: () => ({ available: true }),
    evalCodeWithDiagnostics: hardwareEval,
  } as unknown as WebSerialHostPort;
  const wasm = {
    capabilities: () => ({ available: true }),
    evalCodeWithDiagnostics: wasmEval,
  } as unknown as WasmRuntimePort;
  return { hardware, wasm, hardwareEval, wasmEval };
}

describe("runtime code evaluation authority", () => {
  for (const testCase of [
    { mode: "none" as const, hardware: 0, wasm: 0, authority: null },
    { mode: "wasm" as const, hardware: 0, wasm: 1, authority: "wasm" },
    { mode: "hardware" as const, hardware: 1, wasm: 0, authority: "hardware" },
    { mode: "both" as const, hardware: 1, wasm: 1, authority: "hardware" },
  ]) {
    it(`routes ${testCase.mode} through its live ports`, async () => {
      const p = ports();
      const dispatch = createRuntimeCodeEvaluationDispatcher({
        getSessionState: () => runtimeState(testCase.mode),
        getWasmPort: () => p.wasm,
        hardwarePort: p.hardware,
      });
      const result = await dispatch({ code: "@(a1 1)", wasmCode: "(a1 1)" });

      expect(p.hardwareEval).toHaveBeenCalledTimes(testCase.hardware);
      expect(p.wasmEval).toHaveBeenCalledTimes(testCase.wasm);
      expect(result.diagnosticAuthority).toBe(testCase.authority);
    });
  }

  it("soft eval is WASM-only in both mode", async () => {
    const p = ports();
    const dispatch = createRuntimeCodeEvaluationDispatcher({
      getSessionState: () => runtimeState("both"),
      getWasmPort: () => p.wasm,
      hardwarePort: p.hardware,
    });
    await dispatch({ code: "(a1 1)", soft: true });
    expect(p.hardwareEval).not.toHaveBeenCalled();
    expect(p.wasmEval).toHaveBeenCalledOnce();
  });

  it("resolves changed runtime authority independently for each dispatch", async () => {
    const p = ports();
    let state = runtimeState("wasm");
    const dispatch = createRuntimeCodeEvaluationDispatcher({
      getSessionState: () => state,
      getWasmPort: () => p.wasm,
      hardwarePort: p.hardware,
    });
    await dispatch({ code: "first" });
    state = runtimeState("hardware");
    await dispatch({ code: "second" });
    expect(p.wasmEval).toHaveBeenCalledTimes(1);
    expect(p.hardwareEval).toHaveBeenCalledTimes(1);
    expect(p.hardwareEval).toHaveBeenCalledWith("second");
  });

  it("does not shadow legacy hardware during normal eval", async () => {
    const p = ports();
    const dispatch = createRuntimeCodeEvaluationDispatcher({
      getSessionState: () => runtimeState("both", "legacy"),
      getWasmPort: () => p.wasm,
      hardwarePort: p.hardware,
    });
    await dispatch({ code: "(a1 1)" });
    expect(p.hardwareEval).toHaveBeenCalledOnce();
    expect(p.wasmEval).not.toHaveBeenCalled();
  });

});
