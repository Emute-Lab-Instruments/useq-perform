import { describe, expect, it } from "vitest";

import { resolveBootstrapPlan } from "./bootstrapPlan";

describe("resolveBootstrapPlan", () => {
  it("prefers explicit no-module startup over every other path", () => {
    expect(
      resolveBootstrapPlan({
        noModuleMode: true,
        isWebSerialAvailable: true,
        wasmEnabled: true,
        startLocallyWithoutHardware: true,
      }),
    ).toEqual({
      startupMode: "no-module",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: true,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: false,
    });
  });

  it("starts browser-local first when hardware is available and retained settings allow it", () => {
    expect(
      resolveBootstrapPlan({
        noModuleMode: false,
        isWebSerialAvailable: true,
        wasmEnabled: true,
        startLocallyWithoutHardware: true,
      }),
    ).toEqual({
      startupMode: "browser-local",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: true,
      showUnsupportedBrowserWarning: false,
    });
  });

  it("falls back to pure hardware startup when browser-local runtime is disabled", () => {
    expect(
      resolveBootstrapPlan({
        noModuleMode: false,
        isWebSerialAvailable: true,
        wasmEnabled: false,
        startLocallyWithoutHardware: true,
      }),
    ).toEqual({
      startupMode: "hardware",
      startBrowserLocal: false,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: true,
      showUnsupportedBrowserWarning: false,
    });
  });

  it("keeps working browser-local when Web Serial is disabled or unavailable", () => {
    expect(
      resolveBootstrapPlan({
        noModuleMode: false,
        isWebSerialAvailable: false,
        wasmEnabled: true,
        startLocallyWithoutHardware: true,
      }),
    ).toEqual({
      startupMode: "browser-local",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: false,
    });
  });

  it("surfaces unsupported-browser startup when both Web Serial and WASM are unavailable", () => {
    expect(
      resolveBootstrapPlan({
        noModuleMode: false,
        isWebSerialAvailable: false,
        wasmEnabled: false,
        startLocallyWithoutHardware: false,
      }),
    ).toEqual({
      startupMode: "unsupported-browser",
      startBrowserLocal: false,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: true,
    });
  });
});
