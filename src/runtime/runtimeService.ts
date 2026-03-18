import { Effect } from "effect";

import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import { SHARED_TRANSPORT_COMMANDS } from "../contracts/useqRuntimeContract";
import {
  CONNECTION_CHANGED_EVENT,
  dispatchRuntimeEvent,
  type ConnectionChangedDetail,
} from "../contracts/runtimeEvents";
import type { TransportState } from "../machines/transport.machine";
import {
  publishRuntimeDiagnostics,
  type RuntimeProtocolMode,
} from "./runtimeDiagnostics";
import {
  legacyRuntimeAdapter,
  type LegacyRuntimeAdapter,
} from "./legacyRuntimeAdapter";
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

// Re-export the state type so consumers don't need to reach into the store
export type { RuntimeSessionState } from "./runtimeSessionStore";
import type { RuntimeSessionState } from "./runtimeSessionStore";

let adapter: LegacyRuntimeAdapter = legacyRuntimeAdapter;

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
    dispatchRuntimeEvent(CONNECTION_CHANGED_EVENT, toConnectionChangedDetail(state));
  }

  return state;
}

function syncRuntimeStateFromAdapter(options?: {
  publishDiagnostics?: boolean;
}): RuntimeSessionState {
  const legacyState = adapter.readState();
  return applySessionUpdate(
    {
      ...legacyState.sessionInputs,
      connected: legacyState.connected,
      protocolMode: legacyState.protocolMode,
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
  return syncRuntimeStateFromAdapter({ publishDiagnostics: true });
}

export function announceRuntimeSession(): RuntimeSessionState {
  const state = refreshRuntimeSession();
  dispatchRuntimeEvent(CONNECTION_CHANGED_EVENT, toConnectionChangedDetail(state));
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
  return adapter.toggleConnection();
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
    const state = syncRuntimeStateFromAdapter();
    const effects = [];

    if (supportsHardwareTransport(state.session.transportMode)) {
      effects.push(
        Effect.tryPromise({
          try: () => adapter.sendHardwareCommand(command),
          catch: (error) => new Error(`Hardware error: ${error}`),
        })
      );
    }

    if (supportsWasmTransport(state.session.transportMode)) {
      effects.push(
        Effect.tryPromise({
          try: () => adapter.evalInWasm(command),
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
        adapter
          .sendHardwareCommand(
            SHARED_TRANSPORT_COMMANDS.getState,
            (text: string) => {
              resolve(parseTransportState(text));
            }
          )
          .catch(reject);
      }),
    catch: () => null,
  });
}

export function syncRuntimeWasmTransportState(state: TransportState) {
  return Effect.tryPromise({
    try: () => adapter.syncWasmTransportState(state),
    catch: (error) => new Error(`WASM sync error: ${error}`),
  }).pipe(Effect.catchAll(() => Effect.succeed(null as string | null)));
}

export function resetRuntimeServiceForTests(): void {
  adapter = legacyRuntimeAdapter;
  resetRuntimeSessionState();
}

export function setRuntimeAdapterForTests(nextAdapter: LegacyRuntimeAdapter): void {
  adapter = nextAdapter;
}
