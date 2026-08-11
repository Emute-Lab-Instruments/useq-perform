import { afterEach, describe, expect, it } from "vitest";

import type { WasmRuntimePort } from "../contracts/runtimePorts.ts";
import {
  getActiveWasmRuntimePort,
  getRuntimeSessionState,
  hasActiveWasmRuntimePort,
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
    expect(hasActiveWasmRuntimePort()).toBe(true);

    transitionRuntimeCoordinator({ type: "reset" });
    expect(hasActiveWasmRuntimePort()).toBe(false);
    expect(() => getActiveWasmRuntimePort()).toThrow(/no Worker runtime/i);
    expect(getRuntimeSessionState().session.transportMode).toBe("none");
  });
});
