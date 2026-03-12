import { describe, expect, it } from "vitest";

import {
  createRuntimeSessionSnapshot,
  resolveRuntimeConnectionMode,
  resolveTransportModeFromRuntime,
  supportsHardwareTransport,
  supportsWasmTransport,
} from "./runtimeSession";

describe("runtimeSession", () => {
  it("prefers real hardware when hardware flags are present", () => {
    expect(
      resolveRuntimeConnectionMode({
        hasHardwareConnection: true,
        noModuleMode: true,
        wasmEnabled: true,
      })
    ).toBe("hardware");
  });

  it("returns hardware+broadcast transport only for real hardware connections", () => {
    expect(
      resolveTransportModeFromRuntime({
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
      })
    ).toBe("both");
  });

  it("returns wasm-only transport for browser-local no-module sessions", () => {
    expect(
      resolveTransportModeFromRuntime({
        hasHardwareConnection: false,
        noModuleMode: true,
        wasmEnabled: true,
      })
    ).toBe("wasm");
  });

  it("treats wasm-enabled startup as browser-local even without the no-module URL flag", () => {
    expect(
      createRuntimeSessionSnapshot({
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: true,
      })
    ).toEqual({
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "browser",
      transportMode: "wasm",
    });
  });

  it("captures the resolved connection and transport modes in the snapshot", () => {
    expect(
      createRuntimeSessionSnapshot({
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: false,
      })
    ).toEqual({
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
      connectionMode: "none",
      transportMode: "none",
    });
  });

  it("reports hardware and wasm support from transport mode", () => {
    expect(supportsHardwareTransport("hardware")).toBe(true);
    expect(supportsHardwareTransport("both")).toBe(true);
    expect(supportsHardwareTransport("wasm")).toBe(false);

    expect(supportsWasmTransport("wasm")).toBe(true);
    expect(supportsWasmTransport("both")).toBe(true);
    expect(supportsWasmTransport("hardware")).toBe(false);
  });
});
