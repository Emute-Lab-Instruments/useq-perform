// src/effects/transport.ts
import { Effect } from "effect";
// @ts-ignore - Importing from legacy untyped module
import { sendTouSEQ, isConnectedToModule, getSerialPort } from "../legacy/io/serialComms.ts";
// @ts-ignore - Importing from legacy untyped module
import {
  evalInUseqWasm,
  syncWasmTransportState as syncWasmTransportStateInInterpreter,
} from "../legacy/io/useqWasmInterpreter.ts";
// @ts-ignore - Importing from legacy untyped module
import { activeUserSettings } from "../legacy/utils/persistentUserSettings.ts";
import {
  SHARED_TRANSPORT_COMMANDS,
  type SharedTransportCommand,
} from "../contracts/useqRuntimeContract";
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
 * Fan-out only the shared transport builtins to both hardware (if connected)
 * and WASM (if enabled).
 */
export const sendTransportCommand = (command: SharedTransportCommand) =>
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
        sendTouSEQ(SHARED_TRANSPORT_COMMANDS.getState, (text: string) => {
          resolve(parseTransportState(text));
        });
      }),
    catch: () => null as TransportState | null,
  });

/** Shape of the `useq-json-meta` CustomEvent detail payload. */
interface JsonMetaEventDetail {
  response?: {
    meta?: {
      transport?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

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
  Effect.tryPromise({
    try: () => syncWasmTransportStateInInterpreter(state),
    catch: (error) => new Error(`WASM sync error: ${error}`),
  }).pipe(Effect.catchAll(() => Effect.succeed(null as string | null)));
