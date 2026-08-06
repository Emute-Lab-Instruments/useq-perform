import { afterEach, describe, expect, it } from "vitest";

import type { WasmRuntimePort } from "../contracts/runtimePorts.ts";
import {
  getActiveWasmRuntimePort,
  getRuntimeSessionState,
  isUsingInProcessWasmRuntime,
  transitionRuntimeCoordinator,
} from "./runtimeCoordinator.ts";

afterEach(() => {
  transitionRuntimeCoordinator({ type: "reset" });
});

describe("runtimeCoordinator transitions", () => {
  it("derives runtime modes from one session transition", () => {
    const state = transitionRuntimeCoordinator({
      type: "session",
      updates: {
        connected: true,
        protocolMode: "json",
        hasHardwareConnection: true,
        wasmEnabled: true,
      },
    });

    expect(state.session.transportMode).toBe("both");
    expect(getRuntimeSessionState()).toEqual(state);
  });

  it("owns typed WASM port selection and resets it with the session", () => {
    const workerPort = { kind: "wasm-runtime" } as WasmRuntimePort;
    transitionRuntimeCoordinator({ type: "select-wasm-port", port: workerPort });

    expect(getActiveWasmRuntimePort()).toBe(workerPort);
    expect(isUsingInProcessWasmRuntime()).toBe(false);

    transitionRuntimeCoordinator({ type: "reset" });
    expect(isUsingInProcessWasmRuntime()).toBe(true);
    expect(getRuntimeSessionState().session.transportMode).toBe("wasm");
  });
});
