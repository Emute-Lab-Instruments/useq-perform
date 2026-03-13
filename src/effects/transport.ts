// src/effects/transport.ts
import {
  SHARED_TRANSPORT_COMMANDS,
  type SharedTransportCommand,
} from "../contracts/useqRuntimeContract";
import type { JsonMetaEventDetail } from "../contracts/runtimeEvents";
import type { TransportState } from "../machines/transport.machine";
import {
  getRuntimeServiceSnapshot,
  isRuntimeHardwareConnected,
  isRuntimeWasmEnabled,
  queryRuntimeHardwareTransportState,
  resolveRuntimeTransportMode,
  sendRuntimeTransportCommand,
  syncRuntimeWasmTransportState,
} from "../runtime/runtimeService";

export const getRuntimeSessionSnapshot = () =>
  getRuntimeServiceSnapshot().session;

/**
 * Check if the WASM interpreter is enabled in user settings.
 */
export const isWasmEnabled = () => isRuntimeWasmEnabled();

/**
 * Check if currently connected to a real hardware serial port.
 */
export const isRealHardwareConnection = () =>
  isRuntimeHardwareConnected();

/**
 * Determine the current transport mode based on connection state and settings.
 */
export const resolveTransportMode = (): "hardware" | "wasm" | "both" | "none" => {
  return resolveRuntimeTransportMode();
};

/**
 * Fan-out only the shared transport builtins to both hardware (if connected)
 * and WASM (if enabled).
 */
export const sendTransportCommand = (command: SharedTransportCommand) =>
  sendRuntimeTransportCommand(command);

/**
 * Parse a raw transport state string from hardware into a typed TransportState.
 * Returns null if the value is unrecognized.
 */
export const parseTransportState = (raw: string): TransportState | null => {
  const cleaned = raw.trim().replace(/"/g, "");
  switch (cleaned) {
    case "playing":
    case "paused":
    case "stopped":
      return cleaned;
    default:
      return null;
  }
};

/**
 * Query hardware for transport state via capture callback.
 * Resolves with the parsed TransportState or null if unavailable.
 */
export const queryHardwareTransportState = () =>
  queryRuntimeHardwareTransportState();

/**
 * Extract transport state from a useq-json-meta event's detail.
 */
export const extractTransportStateFromMeta = (
  detail: JsonMetaEventDetail
): TransportState | null => {
  const meta = detail?.response?.meta;
  if (meta && typeof meta.transport === "string") {
    return parseTransportState(meta.transport);
  }
  return null;
};

export const play = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.play);
export const pause = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.pause);
export const stop = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.stop);
export const rewind = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.rewind);
export const clear = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.clear);
export const queryState = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.getState);

/**
 * Mirror a hardware transport state into WASM without sending commands back to hardware.
 */
export const syncWasmTransportState = (state: TransportState) =>
  syncRuntimeWasmTransportState(state);
