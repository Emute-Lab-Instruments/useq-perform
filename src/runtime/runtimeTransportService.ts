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

/** Route transport-map changes to the audio producer owned by the WASM Worker. */
export async function updateRuntimeWasmAudioTransport(
  transition: "start" | "pause" | "resume" | "stop" | "reanchor",
): Promise<void> {
  try {
    const port = getActiveWasmRuntimePort() as WasmRuntimePort & {
      producerReadTelemetry?: () => Promise<{ audioFrame: bigint | number } | null>;
      producerTransportUpdate?: (options: {
        transition: "start" | "pause" | "resume" | "stop" | "reanchor";
        atFrame: bigint;
        atTime?: number;
      }) => Promise<number>;
    };
    if (!port.producerTransportUpdate) return;
    const telemetry = await port.producerReadTelemetry?.();
    const rawFrame = telemetry?.audioFrame ?? 0n;
    const atFrame = typeof rawFrame === "bigint" ? rawFrame : BigInt(Math.max(0, Math.trunc(rawFrame)));
    await port.producerTransportUpdate({ transition, atFrame });
  } catch {
    // Audio is an optional runtime capability; transport command delivery
    // remains owned by the existing hardware/WASM command path.
  }
}
