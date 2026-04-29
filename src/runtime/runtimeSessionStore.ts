import { createStore, reconcile } from "solid-js/store";
import { createRoot, createEffect } from "solid-js";
import type { RuntimeProtocolMode } from "./runtimeDiagnostics";
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

const DEFAULT_INPUTS: RuntimeSessionInputs = {
  hasHardwareConnection: false,
  noModuleMode: false,
  wasmEnabled: true,
};

let currentInputs: RuntimeSessionInputs = { ...DEFAULT_INPUTS };

const INITIAL_STATE: RuntimeSessionState = {
  connected: false,
  protocolMode: "legacy",
  session: createRuntimeSessionSnapshot(DEFAULT_INPUTS),
};

export const [runtimeSessionState, setRuntimeSessionState] =
  createStore<RuntimeSessionState>({ ...INITIAL_STATE });

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

export function updateRuntimeSessionState(
  updates: Partial<RuntimeSessionInputs> & {
    connected?: boolean;
    protocolMode?: RuntimeProtocolMode;
  }
): RuntimeSessionState {
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
  currentInputs = { ...DEFAULT_INPUTS };
  setRuntimeSessionState(
    reconcile({
      connected: false,
      protocolMode: "legacy" as RuntimeProtocolMode,
      session: createRuntimeSessionSnapshot(DEFAULT_INPUTS),
    })
  );
}

/** Remove all listeners and reset state. Test-only. */
export function teardownRuntimeSessionState(): void {
  resetRuntimeSessionState();
}
