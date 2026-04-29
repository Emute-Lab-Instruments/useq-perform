import { Effect } from "effect";

import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import { SHARED_TRANSPORT_COMMANDS } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";
import {
  publishRuntimeDiagnostics,
  type RuntimeProtocolMode,
} from "./runtimeDiagnostics";
import {
  sendTouSEQ,
} from "../transport/json-protocol.ts";
import {
  toggleConnect,
} from "../transport/connector.ts";
import {
  evalInUseqWasm,
  syncWasmTransportState as syncWasmTransportStateInInterpreter,
} from "./wasmInterpreter.ts";
import {
  getRuntimeSessionState,
} from "./runtimeSessionStore";
import {
  supportsHardwareTransport,
  supportsWasmTransport,
  type TransportMode,
} from "./runtimeSession";
import { syncRuntimeState } from "./runtimeSessionService";

// ── Internal helpers ───────────────────────────────────────────

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

// ── Transport orchestration ────────────────────────────────────

export function toggleRuntimeConnection(): Promise<void> {
  return toggleConnect();
}

export function resolveRuntimeTransportMode(): TransportMode {
  return getRuntimeSessionState().session.transportMode;
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
