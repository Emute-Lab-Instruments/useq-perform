import { Effect } from "effect";

import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import { SHARED_TRANSPORT_COMMANDS } from "../contracts/useqRuntimeContract";
import {
  connectionChanged as connectionChangedChannel,
  settingsChanged as settingsChangedChannel,
} from "../contracts/runtimeChannels";
import type { ConnectionChangedDetail } from "../contracts/runtimeChannels";
import type { TransportState } from "../machines/transport.machine";
import type { AppSettings } from "../lib/appSettings";
import {
  publishRuntimeDiagnostics,
  type RuntimeProtocolMode,
} from "./runtimeDiagnostics";
import {
  getProtocolMode,
  sendTouSEQ,
} from "../transport/json-protocol.ts";
import {
  getSerialPort,
  isConnectedToModule,
  toggleConnect,
} from "../transport/connector.ts";
import {
  evalInUseqWasm,
  syncWasmTransportState as syncWasmTransportStateInInterpreter,
} from "./wasmInterpreter.ts";
import { getStartupFlagsSnapshot } from "./startupContext.ts";
import {
  getRuntimeSessionState,
  resetRuntimeSessionState,
  subscribeRuntimeSessionState,
  updateRuntimeSessionState,
} from "./runtimeSessionStore";
import {
  supportsHardwareTransport,
  supportsWasmTransport,
  type RuntimeSessionInputs,
  type TransportMode,
} from "./runtimeSession";
import {
  getAppSettings,
  replaceAppSettings as _replaceAppSettings,
  updateAppSettings as _updateAppSettings,
  resetAppSettings as _resetAppSettings,
  loadAppSettings as _loadAppSettings,
  deletePersistedSettings as _deletePersistedSettings,
} from "./appSettingsRepository";

// Re-export the state type so consumers don't need to reach into the store
export type { RuntimeSessionState } from "./runtimeSessionStore";
import type { RuntimeSessionState } from "./runtimeSessionStore";

function parseTransportState(raw: string): TransportState | null {
  const cleaned = raw.trim().replace(/"/g, "");
  switch (cleaned) {
    case "playing":
    case "paused":
    case "stopped":
      return cleaned;
    default:
      return null;
  }
}

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

function syncRuntimeState(options?: {
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
 * Called by transport producers to publish a diagnostics-only update
 * (e.g. protocol mode changed without a full connection change).
 */
export function reportProtocolModeChanged(
  protocolMode: RuntimeProtocolMode
): void {
  publishRuntimeDiagnostics({ protocolMode });
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

export function toggleRuntimeConnection(): Promise<void> {
  return toggleConnect();
}

export function resolveRuntimeTransportMode(): TransportMode {
  return getRuntimeSessionState().session.transportMode;
}

export function isRuntimeHardwareConnected(): boolean {
  return getRuntimeSessionState().session.hasHardwareConnection;
}

export function isRuntimeWasmEnabled(): boolean {
  return getRuntimeSessionState().session.wasmEnabled;
}

export function sendRuntimeTransportCommand(command: SharedTransportCommand) {
  return Effect.gen(function* (_) {
    const state = syncRuntimeState();
    const effects = [];

    if (supportsHardwareTransport(state.session.transportMode)) {
      effects.push(
        Effect.tryPromise({
          try: () => sendTouSEQ(command),
          catch: (error) => new Error(`Hardware error: ${error}`),
        })
      );
    }

    if (supportsWasmTransport(state.session.transportMode)) {
      effects.push(
        Effect.tryPromise({
          try: () => evalInUseqWasm(command),
          catch: (error) => new Error(`WASM error: ${error}`),
        })
      );
    }

    if (effects.length > 0) {
      yield* _(Effect.all(effects, { concurrency: "unbounded" }));
    }

    return command;
  });
}

export function queryRuntimeHardwareTransportState() {
  const state = getRuntimeSessionState();

  if (!supportsHardwareTransport(state.session.transportMode)) {
    return Effect.succeed(null as TransportState | null);
  }

  return Effect.tryPromise<TransportState | null, TransportState | null>({
    try: (_signal: AbortSignal) =>
      new Promise<TransportState | null>((resolve, reject) => {
        sendTouSEQ(
          SHARED_TRANSPORT_COMMANDS.getState,
          (text: string) => {
            resolve(parseTransportState(text));
          }
        ).catch(reject);
      }),
    catch: () => null,
  });
}

export function syncRuntimeWasmTransportState(state: TransportState) {
  return Effect.tryPromise({
    try: () => syncWasmTransportStateInInterpreter(state),
    catch: (error) => new Error(`WASM sync error: ${error}`),
  }).pipe(Effect.catchAll(() => Effect.succeed(null as string | null)));
}

// ── Settings mutations (sole public surface) ────────────────────
//
// All settings mutations from outside src/runtime/ MUST go through
// these methods.  appSettingsRepository write exports are for internal
// use only (bootstrap + this module).

/**
 * Replace all settings wholesale (e.g. after loading from bootstrap).
 * This is the only public API for full settings replacement.
 */
export function replaceSettings(
  values: unknown,
  options?: { persist?: boolean; dispatch?: boolean },
): AppSettings {
  const result = _replaceAppSettings(values, options);
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Merge a partial settings patch into active settings, persist, and dispatch.
 * This is the primary mutation path for incremental settings changes.
 */
export function updateSettings(values: unknown): AppSettings {
  const result = _updateAppSettings(values);
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Reset settings to defaults (optionally a single section).
 */
export function resetSettings(section?: keyof AppSettings): AppSettings {
  const result = _resetAppSettings(section);
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Reload settings from persistence.
 */
export function loadSettings(): AppSettings {
  const result = _loadAppSettings();
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Delete all persisted settings.
 */
export function deletePersistedSettings(): void {
  _deletePersistedSettings();
}

/**
 * Read current settings snapshot (read-only, no mutation).
 */
export function getSettings(): AppSettings {
  return getAppSettings();
}

export function resetRuntimeServiceForTests(): void {
  resetRuntimeSessionState();
}
