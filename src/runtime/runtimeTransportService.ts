import { Effect } from "effect";

import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";
import {
  publishDiagnosticsSnapshot,
  type RuntimeProtocolMode,
} from "./runtimeDiagnostics";
import type { WasmRuntimePort } from "../contracts/runtimePorts";
import { webSerialHostPort } from "../transport/webSerialHostPort";
import { getActiveWasmRuntimePort } from "./activeWasmRuntimePort";
import {
  getRuntimeSessionState,
} from "./runtimeSessionStore";
import {
  supportsHardwareTransport,
  supportsWasmTransport,
  type TransportMode,
} from "./runtimeSession";
import { syncRuntimeState } from "./runtimeSessionService";

// ── Active port resolution ─────────────────────────────────────
//
// "Which ports should this command go to right now?" used to be expressed as
// branching on the derived TransportMode and calling transport/wasm modules
// directly. With ports, the runtime layer owns a single helper that returns
// the active set, and dispatch is just iteration.
//
// Each call resolves the set freshly from the session store, so we don't
// cache stale port choices across connection-state changes.

interface ActivePorts {
  hardware: typeof webSerialHostPort | null;
  wasm: WasmRuntimePort | null;
}

function activePortsForSharedCommands(): ActivePorts {
  const state = syncRuntimeState();
  return {
    hardware: supportsHardwareTransport(state.session.transportMode)
      ? webSerialHostPort
      : null,
    wasm: supportsWasmTransport(state.session.transportMode)
      ? getActiveWasmRuntimePort()
      : null,
  };
}

// ── Transport orchestration ────────────────────────────────────

export function toggleRuntimeConnection(): Promise<void> {
  return webSerialHostPort.toggleConnection();
}

export function resolveRuntimeTransportMode(): TransportMode {
  return getRuntimeSessionState().session.transportMode;
}

/**
 * Called by transport producers to publish a diagnostics-only update
 * (e.g. protocol mode changed without a full connection change). The published
 * snapshot derives protocolMode from canonical session state; the argument is
 * the change trigger and is not itself published.
 */
export function reportProtocolModeChanged(
  _protocolMode: RuntimeProtocolMode
): void {
  publishDiagnosticsSnapshot();
}

export function sendRuntimeTransportCommand(command: SharedTransportCommand) {
  return Effect.gen(function* (_) {
    const ports = activePortsForSharedCommands();
    const effects = [];

    if (ports.hardware) {
      effects.push(
        Effect.tryPromise({
          try: () => ports.hardware!.sendTransportCommand(command),
          catch: (error) => new Error(`Hardware error: ${error}`),
        })
      );
    }

    if (ports.wasm) {
      effects.push(
        Effect.tryPromise({
          try: () => ports.wasm!.sendTransportCommand(command),
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
  const ports = activePortsForSharedCommands();

  if (!ports.hardware) {
    return Effect.succeed(null as TransportState | null);
  }

  return Effect.tryPromise<TransportState | null, TransportState | null>({
    try: () => ports.hardware!.queryTransportState(),
    catch: () => null,
  });
}

export function syncRuntimeWasmTransportState(state: TransportState) {
  return Effect.tryPromise({
    try: async () => {
      await getActiveWasmRuntimePort().syncTransportState(state);
      return state;
    },
    catch: (error) => new Error(`WASM sync error: ${error}`),
  }).pipe(Effect.catchAll(() => Effect.succeed(null as TransportState | null)));
}
