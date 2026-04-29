import {
  connectionChanged as connectionChangedChannel,
} from "../contracts/runtimeChannels";
import type { ConnectionChangedDetail } from "../contracts/runtimeChannels";
import type { AppSettings } from "../lib/appSettings";
import {
  publishRuntimeDiagnostics,
  type RuntimeProtocolMode,
} from "./runtimeDiagnostics";
import {
  getProtocolMode,
} from "../transport/json-protocol.ts";
import {
  getSerialPort,
  isConnectedToModule,
} from "../transport/connector.ts";
import { getStartupFlagsSnapshot } from "./startupContext.ts";
import {
  getRuntimeSessionState,
  resetRuntimeSessionState,
  subscribeRuntimeSessionState,
  updateRuntimeSessionState,
} from "./runtimeSessionStore";
import {
  type RuntimeSessionInputs,
} from "./runtimeSession";
import {
  getAppSettings,
} from "./appSettingsRepository";

// Re-export the state type so consumers don't need to reach into the store
export type { RuntimeSessionState } from "./runtimeSessionStore";
import type { RuntimeSessionState } from "./runtimeSessionStore";

// ── Internal helpers ───────────────────────────────────────────

function toConnectionChangedDetail(
  state: RuntimeSessionState
): ConnectionChangedDetail {
  return {
    connected: state.connected,
    protocolMode: state.protocolMode,
    ...state.session,
  };
}

// ── Adapter state snapshot ──────────────────────────────────────

interface RuntimeStateSnapshot {
  connected: boolean;
  protocolMode: RuntimeProtocolMode;
  sessionInputs: RuntimeSessionInputs;
}

function readRuntimeState(): RuntimeStateSnapshot {
  const connected = isConnectedToModule();
  const startupFlags = getStartupFlagsSnapshot();
  const settings = getAppSettings();

  return {
    connected,
    protocolMode: getProtocolMode(),
    sessionInputs: {
      hasHardwareConnection: connected && !!getSerialPort(),
      noModuleMode: startupFlags.noModuleMode,
      wasmEnabled: settings.wasm.enabled,
    },
  };
}

/**
 * Internal helper: update store + optionally publish diagnostics + dispatch event.
 * This is the single write-path for all runtime session state changes.
 */
function applySessionUpdate(
  updates: Partial<RuntimeSessionInputs> & {
    connected?: boolean;
    protocolMode?: RuntimeProtocolMode;
  },
  options?: {
    publishDiagnostics?: boolean;
    dispatchConnectionChanged?: boolean;
  }
): RuntimeSessionState {
  const state = updateRuntimeSessionState(updates);

  if (options?.publishDiagnostics) {
    publishRuntimeDiagnostics({
      protocolMode: state.protocolMode,
      runtimeSession: state.session,
    });
  }

  if (options?.dispatchConnectionChanged) {
    connectionChangedChannel.publish(toConnectionChangedDetail(state));
  }

  return state;
}

/**
 * Sync runtime state from external sources (transport, startup flags, settings)
 * into the session store. Exported for use by runtimeTransportService.
 */
export function syncRuntimeState(options?: {
  publishDiagnostics?: boolean;
}): RuntimeSessionState {
  const snapshot = readRuntimeState();
  return applySessionUpdate(
    {
      ...snapshot.sessionInputs,
      connected: snapshot.connected,
      protocolMode: snapshot.protocolMode,
    },
    { publishDiagnostics: options?.publishDiagnostics }
  );
}

// ── Session lifecycle ──────────────────────────────────────────

export function bootstrapRuntimeSession(
  inputs: RuntimeSessionInputs,
  options?: {
    connected?: boolean;
    protocolMode?: RuntimeProtocolMode;
  }
): RuntimeSessionState {
  return applySessionUpdate(
    {
      ...inputs,
      connected: options?.connected ?? false,
      protocolMode: options?.protocolMode ?? "legacy",
    },
    { publishDiagnostics: true }
  );
}

export function refreshRuntimeSession(): RuntimeSessionState {
  return syncRuntimeState({ publishDiagnostics: true });
}

export function announceRuntimeSession(): RuntimeSessionState {
  const state = refreshRuntimeSession();
  connectionChangedChannel.publish(toConnectionChangedDetail(state));
  return state;
}

// ── Transport-fact ingestion (sole owner of state mutation) ──────

/**
 * Called by transport producers (e.g. serialComms) to report a connection
 * state change. runtimeService is the sole owner: it updates the session
 * store, publishes diagnostics, and dispatches the connection-changed event.
 */
export function reportTransportConnectionChanged(facts: {
  connected: boolean;
  protocolMode: RuntimeProtocolMode;
  hasHardwareConnection: boolean;
  noModuleMode: boolean;
  wasmEnabled: boolean;
}): RuntimeSessionState {
  return applySessionUpdate(
    {
      connected: facts.connected,
      protocolMode: facts.protocolMode,
      hasHardwareConnection: facts.hasHardwareConnection,
      noModuleMode: facts.noModuleMode,
      wasmEnabled: facts.wasmEnabled,
    },
    { publishDiagnostics: true, dispatchConnectionChanged: true }
  );
}

/**
 * Called by settings repositories when a setting that affects the runtime
 * session (e.g. wasm.enabled) changes. runtimeService is the sole owner.
 */
export function updateRuntimeSettingsEffect(
  updates: Partial<RuntimeSessionInputs>
): RuntimeSessionState {
  return applySessionUpdate(updates, { publishDiagnostics: true });
}

// ── Snapshot & subscription ─────────────────────────────────────

export function getRuntimeServiceSnapshot(): RuntimeSessionState {
  return getRuntimeSessionState();
}

export function subscribeRuntimeService(
  listener: (state: RuntimeSessionState) => void
): () => void {
  return subscribeRuntimeSessionState(listener);
}

export function isRuntimeHardwareConnected(): boolean {
  return getRuntimeSessionState().session.hasHardwareConnection;
}

export function isRuntimeWasmEnabled(): boolean {
  return getRuntimeSessionState().session.wasmEnabled;
}

export function resetRuntimeServiceForTests(): void {
  resetRuntimeSessionState();
}
