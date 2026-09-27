import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";
import type { TransportState } from "../machines/transport.machine";
import type { WasmRuntimePort } from "../contracts/runtimePorts";
import { webSerialHostPort } from "../transport/webSerialHostPort";
import {
  getActiveWasmRuntimePort,
  getRuntimeSessionState,
} from "./runtimeCoordinator";
import {
  supportsHardwareTransport,
  supportsWasmTransport,
} from "./runtimeSession";

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
  const state = getRuntimeSessionState();
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

/** Send concurrently to the currently active ports, retaining error attribution. */
export async function sendRuntimeTransportCommand(command: SharedTransportCommand): Promise<SharedTransportCommand> {
  const ports = activePortsForSharedCommands();
  await Promise.all((["hardware", "wasm"] as const).map(async (kind) => {
    const port = ports[kind];
    if (!port) return;
    try {
      await port.sendTransportCommand(command);
    } catch (error) {
      throw new Error(`${kind === "hardware" ? "Hardware" : "WASM"} error: ${error}`);
    }
  }));
  return command;
}

export async function queryRuntimeHardwareTransportState(): Promise<TransportState | null> {
  const { hardware } = activePortsForSharedCommands();
  if (!hardware) return null;
  try {
    return await hardware.queryTransportState();
  } catch {
    return null;
  }
}

export async function syncRuntimeWasmTransportState(state: TransportState): Promise<TransportState | null> {
  try {
    await getActiveWasmRuntimePort().syncTransportState(state);
    return state;
  } catch {
    return null;
  }
}
