// src-solid/effects/transport.ts
import { Effect } from "effect";
// @ts-ignore - Importing from .mjs in src
import { sendTouSEQ, isConnectedToModule } from "../../src/io/serialComms.mjs";
// @ts-ignore - Importing from .mjs in src
import { evalInUseqWasm } from "../../src/io/useqWasmInterpreter.mjs";
// @ts-ignore - Importing from .mjs in src
import { activeUserSettings } from "../../src/utils/persistentUserSettings.mjs";

/**
 * Check if the WASM interpreter is enabled in user settings.
 */
export const isWasmEnabled = () => activeUserSettings?.wasm?.enabled ?? true;

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

export const play = () => sendTransportCommand("(useq-play)");
export const pause = () => sendTransportCommand("(useq-pause)");
export const stop = () => sendTransportCommand("(useq-stop)");
export const rewind = () => sendTransportCommand("(useq-rewind)");
export const clear = () => sendTransportCommand("(useq-clear)");
export const queryState = () => sendTransportCommand("(useq-get-transport-state)");
