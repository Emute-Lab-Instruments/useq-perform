/**
 * Browser-local WASM lifecycle module.
 *
 * Settings own configured intent. This module owns Worker construction,
 * readiness, one-shot crash recovery, disposal, and publishing *actual*
 * availability to the runtime coordinator. Callers never derive `wasm` or
 * `both` from the setting alone.
 */
import type { WasmRuntimePort } from "../contracts/runtimePorts.ts";
import {
  transitionRuntimeCoordinator,
} from "./runtimeCoordinator.ts";
import { publishDiagnosticsSnapshot } from "./runtimeDiagnostics.ts";
import {
  createWasmRuntimeWorkerPort,
  type WasmRuntimeWorkerError,
} from "./wasmRuntimeWorkerPort.ts";

export type BrowserWasmFailureReason =
  | "worker-unavailable"
  | "abi-mismatch"
  | "load-failed"
  | "crash-recovery-failed";

export interface BrowserWasmFailure {
  reason: BrowserWasmFailureReason;
  error: Error;
}

export interface BrowserWasmRuntimeController {
  configure(enabled: boolean): Promise<boolean>;
  dispose(): void;
}

interface BrowserWasmRuntimeDependencies {
  workerSupported(): boolean;
  createPort(onCrash: (error: WasmRuntimeWorkerError) => void): WasmRuntimePort;
  onFailure?(failure: BrowserWasmFailure): void;
  onRecovered?(): void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function failureReason(error: Error): BrowserWasmFailureReason {
  return "code" in error && error.code === "abi-mismatch"
    ? "abi-mismatch"
    : "load-failed";
}

export function createBrowserWasmRuntimeController(
  dependencies: Partial<BrowserWasmRuntimeDependencies> = {},
): BrowserWasmRuntimeController {
  const workerSupported = dependencies.workerSupported
    ?? (() => typeof Worker !== "undefined");
  const createPort = dependencies.createPort
    ?? ((onCrash) => createWasmRuntimeWorkerPort({ onCrash }));

  let configured = false;
  let disposed = false;
  let generation = 0;
  let currentPort: WasmRuntimePort | null = null;
  let currentActivation: Promise<boolean> | null = null;
  let recovering = false;

  function publishUnavailable(port?: WasmRuntimePort): void {
    transitionRuntimeCoordinator({ type: "clear-wasm-port", port });
    publishDiagnosticsSnapshot();
  }

  function publishAvailable(): void {
    transitionRuntimeCoordinator({ type: "wasm-availability", available: true });
    publishDiagnosticsSnapshot();
  }

  function disposePort(port: WasmRuntimePort | null): void {
    port?.dispose();
  }

  async function activate(
    activationGeneration: number,
    recoveryAttempt: boolean,
  ): Promise<boolean> {
    if (disposed || !configured || activationGeneration !== generation) {
      return false;
    }
    if (!workerSupported()) {
      publishUnavailable();
      dependencies.onFailure?.({
        reason: "worker-unavailable",
        error: new Error("This browser does not provide Web Worker support"),
      });
      return false;
    }

    let port: WasmRuntimePort;
    try {
      port = createPort((error) => {
        void recoverAfterCrash(port, error);
      });
    } catch (error) {
      const failure = asError(error);
      publishUnavailable();
      dependencies.onFailure?.({
        reason: recoveryAttempt ? "crash-recovery-failed" : failureReason(failure),
        error: failure,
      });
      return false;
    }

    currentPort = port;
    transitionRuntimeCoordinator({ type: "select-wasm-port", port });
    transitionRuntimeCoordinator({ type: "wasm-availability", available: false });

    try {
      await port.ensureLoaded();
      if (
        disposed
        || !configured
        || activationGeneration !== generation
        || currentPort !== port
      ) {
        disposePort(port);
        return false;
      }
      publishAvailable();
      if (recoveryAttempt) dependencies.onRecovered?.();
      return true;
    } catch (error) {
      if (currentPort === port) currentPort = null;
      disposePort(port);
      publishUnavailable(port);
      const failure = asError(error);
      dependencies.onFailure?.({
        reason: recoveryAttempt ? "crash-recovery-failed" : failureReason(failure),
        error: failure,
      });
      return false;
    }
  }

  async function recoverAfterCrash(
    crashedPort: WasmRuntimePort,
    error: WasmRuntimeWorkerError,
  ): Promise<void> {
    if (
      recovering
      || disposed
      || !configured
      || currentPort !== crashedPort
    ) return;

    recovering = true;
    const recoveryGeneration = ++generation;
    currentPort = null;
    disposePort(crashedPort);
    publishUnavailable(crashedPort);
    const recovery = activate(recoveryGeneration, true);
    currentActivation = recovery;
    try {
      await recovery;
    } finally {
      if (currentActivation === recovery) currentActivation = null;
      recovering = false;
    }
    void error;
  }

  return {
    configure(enabled: boolean): Promise<boolean> {
      if (disposed) return Promise.resolve(false);

      if (enabled && configured && currentPort) {
        if (currentPort.capabilities().available) {
          publishAvailable();
          return Promise.resolve(true);
        }
        if (currentActivation) return currentActivation;
      }

      configured = enabled;
      const activationGeneration = ++generation;

      if (!enabled) {
        const port = currentPort;
        currentPort = null;
        currentActivation = null;
        recovering = false;
        disposePort(port);
        publishUnavailable(port ?? undefined);
        return Promise.resolve(false);
      }

      const previous = currentPort;
      currentPort = null;
      disposePort(previous);
      publishUnavailable(previous ?? undefined);
      const activation = activate(activationGeneration, false);
      currentActivation = activation;
      void activation.finally(() => {
        if (currentActivation === activation) currentActivation = null;
      });
      return currentActivation;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      configured = false;
      generation += 1;
      const port = currentPort;
      currentPort = null;
      currentActivation = null;
      recovering = false;
      disposePort(port);
      publishUnavailable(port ?? undefined);
    },
  };
}

let installedController: BrowserWasmRuntimeController | null = null;

export function installBrowserWasmRuntimeController(
  controller: BrowserWasmRuntimeController,
): void {
  installedController?.dispose();
  installedController = controller;
}

export function configureInstalledBrowserWasmRuntime(
  enabled: boolean,
): Promise<boolean> {
  return installedController?.configure(enabled) ?? Promise.resolve(false);
}

export function uninstallBrowserWasmRuntimeController(
  controller: BrowserWasmRuntimeController,
): void {
  if (installedController !== controller) return;
  controller.dispose();
  installedController = null;
}
