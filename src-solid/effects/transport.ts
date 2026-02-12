// src-solid/effects/transport.ts
import { Effect } from "effect";
// @ts-ignore - Importing from .mjs in src
import { sendTouSEQ, isConnectedToModule, getSerialPort } from "../../src/io/serialComms.mjs";
// @ts-ignore - Importing from .mjs in src
import { evalInUseqWasm } from "../../src/io/useqWasmInterpreter.mjs";
// @ts-ignore - Importing from .mjs in src
import { activeUserSettings } from "../../src/utils/persistentUserSettings.mjs";
import type { TransportState } from "../machines/transport.machine";

/**
 * Check if the WASM interpreter is enabled in user settings.
 */
export const isWasmEnabled = () => activeUserSettings?.wasm?.enabled ?? true;

/**
 * Check if currently connected to a real hardware serial port.
 */
export const isRealHardwareConnection = () =>
  isConnectedToModule() && !!getSerialPort();

/**
 * Determine the current transport mode based on connection state and settings.
 */
export const resolveTransportMode = (): "hardware" | "wasm" | "both" | "none" => {
  const hw = isConnectedToModule();
  const wasm = isWasmEnabled();
  if (hw && wasm) return "both";
  if (hw) return "hardware";
  if (wasm) return "wasm";
  return "none";
};

/**
 * Fan-out a transport command to both hardware (if connected) and WASM (if enabled).
 */
export const sendTransportCommand = (command: string) =>
  Effect.gen(function* (_) {
    const connected = isConnectedToModule();
    const wasmEnabled = isWasmEnabled();

    const effects = [];

    if (connected) {
      effects.push(
        Effect.tryPromise({
          try: () => sendTouSEQ(command),
          catch: (error) => new Error(`Hardware error: ${error}`),
        })
      );
    }

    if (wasmEnabled) {
      effects.push(
        Effect.tryPromise({
          try: () => evalInUseqWasm(command),
          catch: (error) => new Error(`WASM error: ${error}`),
        })
      );
    }

    if (effects.length > 0) {
      // Use all to run them concurrently
      yield* _(Effect.all(effects, { concurrency: "unbounded" }));
    }

    return command;
  });

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
  Effect.tryPromise<TransportState | null>({
    try: () =>
      new Promise<TransportState | null>((resolve) => {
        sendTouSEQ("(useq-get-transport-state)", (text: string) => {
          resolve(parseTransportState(text));
        });
      }),
    catch: () => null as TransportState | null,
  });

/**
 * Extract transport state from a useq-json-meta event's detail.
 */
export const extractTransportStateFromMeta = (
  detail: any
): TransportState | null => {
  const meta = detail?.response?.meta;
  if (meta && typeof meta.transport === "string") {
    return parseTransportState(meta.transport);
  }
  return null;
};

export const play = () => sendTransportCommand("(useq-play)");
export const pause = () => sendTransportCommand("(useq-pause)");
export const stop = () => sendTransportCommand("(useq-stop)");
export const rewind = () => sendTransportCommand("(useq-rewind)");
export const clear = () => sendTransportCommand("(useq-clear)");
export const queryState = () => sendTransportCommand("(useq-get-transport-state)");
