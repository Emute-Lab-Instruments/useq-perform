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
let currentState: RuntimeSessionState = {
  connected: false,
  protocolMode: "legacy",
  session: createRuntimeSessionSnapshot(DEFAULT_INPUTS),
};

const listeners = new Set<RuntimeSessionListener>();

function cloneState(): RuntimeSessionState {
  return {
    connected: currentState.connected,
    protocolMode: currentState.protocolMode,
    session: { ...currentState.session },
  };
}

function notifyListeners(): void {
  const snapshot = cloneState();
  const frozen = [...listeners];
  for (const listener of frozen) {
    if (listeners.has(listener)) listener(snapshot);
  }
}

export function getRuntimeSessionState(): RuntimeSessionState {
  return cloneState();
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

  currentState = {
    connected: updates.connected ?? currentState.connected,
    protocolMode: updates.protocolMode ?? currentState.protocolMode,
    session: createRuntimeSessionSnapshot(currentInputs),
  };

  notifyListeners();
  return cloneState();
}

export function subscribeRuntimeSessionState(
  listener: RuntimeSessionListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetRuntimeSessionState(): void {
  currentInputs = { ...DEFAULT_INPUTS };
  currentState = {
    connected: false,
    protocolMode: "legacy",
    session: createRuntimeSessionSnapshot(DEFAULT_INPUTS),
  };
  notifyListeners();
}

/** Remove all listeners and reset state. Test-only. */
export function teardownRuntimeSessionState(): void {
  listeners.clear();
  resetRuntimeSessionState();
}
