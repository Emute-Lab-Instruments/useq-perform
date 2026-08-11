import { beforeEach, describe, expect, it } from "vitest";
import {
  resetRuntimeSessionState,
  transitionRuntimeCoordinator,
  updateRuntimeSessionState,
} from "./runtimeCoordinator.ts";
import type { WasmRuntimePort } from "../contracts/runtimePorts.ts";
import { shouldUseWasmShadow } from "./runtimeCompatibility.ts";

describe("WASM shadow compatibility", () => {
  beforeEach(() => {
    resetRuntimeSessionState();
    transitionRuntimeCoordinator({
      type: "select-wasm-port",
      port: { kind: "wasm-runtime" } as WasmRuntimePort,
    });
    transitionRuntimeCoordinator({ type: "wasm-availability", available: true });
  });

  it("keeps WASM active without hardware and with JSON firmware", () => {
    expect(shouldUseWasmShadow()).toBe(true);
    updateRuntimeSessionState({
      hasHardwareConnection: true,
      connected: true,
      protocolMode: "json",
    });
    expect(shouldUseWasmShadow()).toBe(true);
  });

  it("makes pre-1.2 hardware authoritative without unloading WASM", () => {
    updateRuntimeSessionState({
      hasHardwareConnection: true,
      connected: true,
      protocolMode: "legacy",
      wasmEnabled: true,
    });
    expect(shouldUseWasmShadow()).toBe(false);
  });

  it("does not invent a shadow when no Worker port is selected", () => {
    transitionRuntimeCoordinator({ type: "select-wasm-port", port: null });
    expect(shouldUseWasmShadow()).toBe(false);
  });
});
