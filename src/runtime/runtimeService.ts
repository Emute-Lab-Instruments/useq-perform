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
  type RuntimeSessionState,
} from "./runtimeSessionStore";
import {
  supportsHardwareTransport,
  supportsWasmTransport,
  type RuntimeSessionInputs,
  type TransportMode,
} from "./runtimeSession";

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

function syncRuntimeStateFromAdapter(options?: {
  publishDiagnostics?: boolean;
}): RuntimeSessionState {
  const legacyState = adapter.readState();
  const state = updateRuntimeSessionState({
    ...legacyState.sessionInputs,
    connected: legacyState.connected,
    protocolMode: legacyState.protocolMode,
  });

  if (options?.publishDiagnostics) {
    publishRuntimeDiagnostics({
      protocolMode: state.protocolMode,
      runtimeSession: state.session,
    });
  }

  return state;
}

export function bootstrapRuntimeSession(
  inputs: RuntimeSessionInputs,
  options?: {
    connected?: boolean;
    protocolMode?: RuntimeProtocolMode;
  }
): RuntimeSessionState {
  const state = updateRuntimeSessionState({
    ...inputs,
    connected: options?.connected ?? false,
    protocolMode: options?.protocolMode ?? "legacy",
  });

  publishRuntimeDiagnostics({
    protocolMode: state.protocolMode,
    runtimeSession: state.session,
  });

  return state;
}

export function refreshRuntimeSession(): RuntimeSessionState {
  return syncRuntimeStateFromAdapter({ publishDiagnostics: true });
}

export function announceRuntimeSession(): RuntimeSessionState {
  const state = refreshRuntimeSession();
  dispatchRuntimeEvent(CONNECTION_CHANGED_EVENT, toConnectionChangedDetail(state));
  return state;
}

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
  const state = syncRuntimeStateFromAdapter();

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
