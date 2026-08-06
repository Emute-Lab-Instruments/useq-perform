/**
 * Canonical owner of live runtime selection and session state.
 *
 * Every mutable runtime decision enters through `transitionRuntimeCoordinator`:
 * session facts/settings, the selected typed WASM port, or a full reset. The
 * serial driver remains an edge adapter and reports facts through the runtime
 * session service; it does not own the derived runtime mode.
 */
import { createStore, reconcile } from "solid-js/store";
import { createRoot, createEffect } from "solid-js";
import type { WasmRuntimePort } from "../contracts/runtimePorts";
import type { RuntimeProtocolMode } from "./runtimeDiagnostics";
import { wasmRuntimePort as inProcessWasmPort } from "./wasmRuntimePort.ts";
import {
  createRuntimeSessionSnapshot,
  type RuntimeSessionInputs,
  type RuntimeSessionSnapshot,
} from "./runtimeSession";

export interface RuntimeSessionState {
  connected: boolean;
  protocolMode: RuntimeProtocolMode;
  session: RuntimeSessionSnapshot;
}

type RuntimeSessionListener = (state: RuntimeSessionState) => void;

type RuntimeSessionUpdate = Partial<RuntimeSessionInputs> & {
  connected?: boolean;
  protocolMode?: RuntimeProtocolMode;
};

export type RuntimeCoordinatorTransition =
  | { type: "session"; updates: RuntimeSessionUpdate }
  | { type: "select-wasm-port"; port: WasmRuntimePort }
  | { type: "reset" };

const DEFAULT_INPUTS: RuntimeSessionInputs = {
  hasHardwareConnection: false,
  noModuleMode: false,
  wasmEnabled: true,
};

let currentInputs: RuntimeSessionInputs = { ...DEFAULT_INPUTS };
let activeWasmPort: WasmRuntimePort = inProcessWasmPort;

function createDefaultState(): RuntimeSessionState {
  return {
    connected: false,
    protocolMode: "legacy",
    session: createRuntimeSessionSnapshot(DEFAULT_INPUTS),
  };
}

export const [runtimeSessionState, setRuntimeSessionState] =
  createStore<RuntimeSessionState>(createDefaultState());

// ── Snapshot helper ───────────────────────────────────────────────
// Callers that need a plain object (e.g. spreading into channel payloads)
// get a shallow clone, preserving the existing contract.

function snapshotState(): RuntimeSessionState {
  return {
    connected: runtimeSessionState.connected,
    protocolMode: runtimeSessionState.protocolMode,
    session: { ...runtimeSessionState.session },
  };
}

// ── Public API ────────────────────────────────────────────────────

export function getRuntimeSessionState(): RuntimeSessionState {
  return snapshotState();
}

function applySessionUpdate(updates: RuntimeSessionUpdate): RuntimeSessionState {
  currentInputs = {
    ...currentInputs,
    ...updates,
  };

  const nextState: RuntimeSessionState = {
    connected: updates.connected ?? runtimeSessionState.connected,
    protocolMode: updates.protocolMode ?? runtimeSessionState.protocolMode,
    session: createRuntimeSessionSnapshot(currentInputs),
  };

  setRuntimeSessionState(reconcile(nextState));

  return snapshotState();
}

/** The only mutation surface for runtime session and port selection. */
export function transitionRuntimeCoordinator(
  transition: RuntimeCoordinatorTransition,
): RuntimeSessionState {
  switch (transition.type) {
    case "session":
      return applySessionUpdate(transition.updates);
    case "select-wasm-port":
      activeWasmPort = transition.port;
      return snapshotState();
    case "reset":
      currentInputs = { ...DEFAULT_INPUTS };
      activeWasmPort = inProcessWasmPort;
      setRuntimeSessionState(reconcile(createDefaultState()));
      return snapshotState();
  }
}

/** Snapshot of the typed WASM edge selected by bootstrap. */
export function getActiveWasmRuntimePort(): WasmRuntimePort {
  return activeWasmPort;
}

export function isUsingInProcessWasmRuntime(): boolean {
  return activeWasmPort === inProcessWasmPort;
}

/**
 * Subscribe to store changes. Bridges SolidJS reactivity to imperative
 * listeners used by service-layer code. Each subscription gets its own
 * reactive root so it can be independently disposed.
 */
export function subscribeRuntimeSessionState(
  listener: RuntimeSessionListener
): () => void {
  let isFirst = true;
  const dispose = createRoot((disposeFn) => {
    createEffect(() => {
      // Read every top-level property to establish tracking
      const snapshot: RuntimeSessionState = {
        connected: runtimeSessionState.connected,
        protocolMode: runtimeSessionState.protocolMode,
        session: { ...runtimeSessionState.session },
      };

      // Skip the initial synchronous run — only notify on actual changes
      if (isFirst) {
        isFirst = false;
        return;
      }

      listener(snapshot);
    });

    return disposeFn;
  });

  return dispose;
}

export function resetRuntimeSessionState(): void {
  transitionRuntimeCoordinator({ type: "reset" });
}

/** Compatibility wrapper; new runtime code uses the explicit transition. */
export function updateRuntimeSessionState(
  updates: RuntimeSessionUpdate,
): RuntimeSessionState {
  return transitionRuntimeCoordinator({ type: "session", updates });
}

/** Remove all listeners and reset state. Test-only. */
export function teardownRuntimeSessionState(): void {
  resetRuntimeSessionState();
}
