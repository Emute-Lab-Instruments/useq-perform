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

  it("does not let a stale rejected activation downgrade its replacement", async () => {
    const firstLoad = deferred<void>();
    const secondLoad = deferred<void>();
    const first = fakePort(firstLoad.promise);
    const second = fakePort(secondLoad.promise);
    const failures: BrowserWasmFailure[] = [];
    const firstController = createBrowserWasmRuntimeController({ workerSupported: () => true, createPort: () => first, onFailure: (f) => failures.push(f) });
    const secondController = createBrowserWasmRuntimeController({ workerSupported: () => true, createPort: () => second, onFailure: (f) => failures.push(f) });
    const firstActivation = firstController.configure(true);
    firstController.dispose();
    const secondActivation = secondController.configure(true);
    secondLoad.resolve();
    await secondActivation;
    firstLoad.reject(new Error("stale load failed"));
    await firstActivation;
    expect(getRuntimeSessionState().session.transportMode).toBe("wasm");
    expect(hasActiveWasmRuntimePort()).toBe(true);
    expect(failures).toEqual([]);
  });

  it("disposes a pending activation without publishing its later success", async () => {
    const load = deferred<void>();
    const port = fakePort(load.promise);
    const controller = createBrowserWasmRuntimeController({ workerSupported: () => true, createPort: () => port });
    const activation = controller.configure(true);
    await controller.configure(false);
    load.resolve();
    await expect(activation).resolves.toBe(false);
    expect(port.dispose).toHaveBeenCalled();
    expect(getRuntimeSessionState().session.transportMode).toBe("none");
  });

  it("ignores a crashed old port after a reconfiguration selected a new port", async () => {
    const first = fakePort(Promise.resolve());
    const second = fakePort(Promise.resolve());
    const handlers: Array<(error: WasmRuntimeWorkerError) => void> = [];
    const firstController = createBrowserWasmRuntimeController({ workerSupported: () => true, createPort: (h) => { handlers.push(h); return first; } });
    const secondController = createBrowserWasmRuntimeController({ workerSupported: () => true, createPort: () => second });
    await firstController.configure(true);
    firstController.dispose();
    await secondController.configure(true);
    handlers[0](new WasmRuntimeWorkerError("worker-crashed", "late crash"));
    await Promise.resolve();
    expect(getRuntimeSessionState().session.transportMode).toBe("wasm");
    expect(second.dispose).not.toHaveBeenCalled();
  });
});
