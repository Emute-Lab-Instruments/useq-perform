import type { TransportState } from "../machines/transport.machine";

export const SHARED_TRANSPORT_COMMANDS = Object.freeze({
  play: "(useq-play)",
  pause: "(useq-pause)",
  stop: "(useq-stop)",
  rewind: "(useq-rewind)",
  clear: "(useq-clear)",
  getState: "(useq-get-transport-state)",
} as const);

export type SharedTransportCommand =
  typeof SHARED_TRANSPORT_COMMANDS[keyof typeof SHARED_TRANSPORT_COMMANDS];

export const SHARED_TRANSPORT_COMMAND_LIST = Object.freeze(
  Object.values(SHARED_TRANSPORT_COMMANDS)
) as readonly SharedTransportCommand[];

export const TRANSPORT_STATE_TO_COMMAND: Readonly<Record<TransportState, SharedTransportCommand>> = Object.freeze({
  playing: SHARED_TRANSPORT_COMMANDS.play,
  paused: SHARED_TRANSPORT_COMMANDS.pause,
  stopped: SHARED_TRANSPORT_COMMANDS.stop,
});

export const EDITOR_RUNTIME_CONTRACT = Object.freeze({
  sharedTransportBuiltins: SHARED_TRANSPORT_COMMAND_LIST,
  hardwareOnlyJsonRequests: Object.freeze(["hello", "ping", "stream-config"] as const),
  hardwareOnlyCapabilities: Object.freeze([
    "json-handshake",
    "json-heartbeat",
    "serial-input-streams",
    "serial-output-streams",
  ] as const),
  wasmOnlyCapabilities: Object.freeze([
    "update-time",
    "output-sampling",
    "batch-output-sampling",
  ] as const),
});

export function isSharedTransportCommand(command: string): command is SharedTransportCommand {
  return SHARED_TRANSPORT_COMMAND_LIST.includes(command as SharedTransportCommand);
}

export function assertEditorRuntimeContract(): void {
  const sharedCommandSet = new Set(SHARED_TRANSPORT_COMMAND_LIST);

  if (sharedCommandSet.size !== SHARED_TRANSPORT_COMMAND_LIST.length) {
    throw new Error("Shared uSEQ transport commands must be unique");
  }

  for (const command of Object.values(TRANSPORT_STATE_TO_COMMAND)) {
    if (!sharedCommandSet.has(command)) {
      throw new Error(`Transport state mapping references non-shared command: ${command}`);
    }
  }
}

assertEditorRuntimeContract();
