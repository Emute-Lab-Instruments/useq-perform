import { beforeEach, describe, expect, it } from "vitest";
import {
  resetRuntimeSessionState,
  updateRuntimeSessionState,
} from "./runtimeSessionStore.ts";
import { shouldUseWasmShadow } from "./runtimeCompatibility.ts";

describe("WASM shadow compatibility", () => {
  beforeEach(() => resetRuntimeSessionState());

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
});
