import { afterEach, describe, expect, it, vi } from "vitest";

import type { WasmRuntimePort } from "../contracts/runtimePorts.ts";
import {
  getRuntimeSessionState,
  hasActiveWasmRuntimePort,
  transitionRuntimeCoordinator,
} from "./runtimeCoordinator.ts";
import {
  createBrowserWasmRuntimeController,
  type BrowserWasmFailure,
} from "./browserWasmRuntime.ts";
import { WasmRuntimeWorkerError } from "./wasmRuntimeWorkerPort.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakePort(load: Promise<void>) {
  let available = false;
  const port = {
    kind: "wasm-runtime" as const,
    dispose: vi.fn(),
    capabilities: vi.fn(() => ({
      available,
      enabled: true,
      supportsEval: available,
      supportsTimeWindow: available,
      supportsTickAndProject: available,
      supportsLiveInputs: available,
    })),
    ensureLoaded: vi.fn(async () => {
      await load;
      available = true;
    }),
  } as unknown as WasmRuntimePort;
  return port;
}

afterEach(() => {
  transitionRuntimeCoordinator({ type: "reset" });
});

describe("browser WASM runtime lifecycle", () => {
  it("publishes actual availability only after the Worker handshake", async () => {
    const load = deferred<void>();
    const port = fakePort(load.promise);
    const controller = createBrowserWasmRuntimeController({
      workerSupported: () => true,
      createPort: () => port,
    });

    const activation = controller.configure(true);
    expect(hasActiveWasmRuntimePort()).toBe(true);
    expect(getRuntimeSessionState().session.transportMode).toBe("none");

    load.resolve();
    await activation;
    expect(getRuntimeSessionState().session.transportMode).toBe("wasm");
  });

  it("does not let hardware facts manufacture WASM availability", () => {
    transitionRuntimeCoordinator({
      type: "session",
      updates: { connected: true, hasHardwareConnection: true, protocolMode: "json" },
    });

    expect(getRuntimeSessionState().session.transportMode).toBe("hardware");
  });

  it("disposes the selected Worker and downgrades truthfully when disabled", async () => {
    const port = fakePort(Promise.resolve());
    const controller = createBrowserWasmRuntimeController({
      workerSupported: () => true,
      createPort: () => port,
    });
    await controller.configure(true);
    transitionRuntimeCoordinator({
      type: "session",
      updates: { connected: true, hasHardwareConnection: true, protocolMode: "json" },
    });

    await controller.configure(false);

    expect(port.dispose).toHaveBeenCalledTimes(1);
    expect(hasActiveWasmRuntimePort()).toBe(false);
    expect(getRuntimeSessionState().session.transportMode).toBe("hardware");
  });

  it("replaces a crashed Worker once and restores availability", async () => {
    const first = fakePort(Promise.resolve());
    const replacement = fakePort(Promise.resolve());
    const ports = [first, replacement];
    const crashHandlers: Array<(error: WasmRuntimeWorkerError) => void> = [];
    const onRecovered = vi.fn();
    const controller = createBrowserWasmRuntimeController({
      workerSupported: () => true,
      createPort: (onCrash) => {
        crashHandlers.push(onCrash);
        return ports.shift()!;
      },
      onRecovered,
    });
    await controller.configure(true);

    crashHandlers[0](new WasmRuntimeWorkerError("worker-crashed", "boom"));
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(replacement.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(getRuntimeSessionState().session.transportMode).toBe("wasm");
  });

  it("preserves ABI mismatch as a distinct actionable failure", async () => {
    const failures: BrowserWasmFailure[] = [];
    const port = fakePort(Promise.reject(
      new WasmRuntimeWorkerError("abi-mismatch", "missing useq_eval"),
    ));
    const controller = createBrowserWasmRuntimeController({
      workerSupported: () => true,
      createPort: () => port,
      onFailure: (failure) => failures.push(failure),
    });

    await expect(controller.configure(true)).resolves.toBe(false);
    expect(failures).toMatchObject([{ reason: "abi-mismatch" }]);
    expect(getRuntimeSessionState().session.transportMode).toBe("none");
  });
});
