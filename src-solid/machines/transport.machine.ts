// src-solid/machines/transport.machine.ts
import { createMachine, assign } from "xstate";

export type TransportState = "playing" | "paused" | "stopped";

export type TransportContext = {
  // We can track more context here if needed, 
  // like whether we're in hardware, wasm or both mode.
  mode: "hardware" | "wasm" | "both" | "none";
};

export type TransportEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "REWIND" }
  | { type: "CLEAR" }
  | { type: "SYNC"; state: TransportState }
  | { type: "UPDATE_MODE"; mode: TransportContext["mode"] };

export const transportMachine = createMachine(
  {
    types: {} as {
      context: TransportContext;
      events: TransportEvent;
    },
    id: "transport",
    initial: "playing", // Hardware boots in "playing" state by default
    context: {
      mode: "none",
    },
    on: {
      SYNC: [
        {
          target: ".playing",
          guard: ({ event }) => event.type === "SYNC" && event.state === "playing",
          actions: "syncWasmPlay",
        },
        {
          target: ".paused",
          guard: ({ event }) => event.type === "SYNC" && event.state === "paused",
          actions: "syncWasmPause",
        },
        {
          target: ".stopped",
          guard: ({ event }) => event.type === "SYNC" && event.state === "stopped",
          actions: "syncWasmStop",
        },
      ],
      UPDATE_MODE: {
        actions: assign({
          mode: ({ event }) => event.mode,
        }),
      },
      CLEAR: {
        actions: "emitClear",
      },
    },
    states: {
      playing: {
        on: {
          PAUSE: {
            target: "paused",
            actions: "emitPause",
          },
          STOP: {
            target: "stopped",
            actions: "emitStop",
          },
          REWIND: {
            target: "stopped",
            actions: ["emitRewind", "emitStop"],
          },
        },
      },
      paused: {
        on: {
          PLAY: {
            target: "playing",
            actions: "emitPlay",
          },
          STOP: {
            target: "stopped",
            actions: "emitStop",
          },
          REWIND: {
            target: "stopped",
            actions: ["emitRewind", "emitStop"],
          },
        },
      },
      stopped: {
        on: {
          PLAY: {
            target: "playing",
            actions: "emitPlay",
          },
          REWIND: {
            actions: "emitRewind",
          },
        },
      },
    },
  },
  {
    actions: {
      emitPlay: () => {},
      emitPause: () => {},
      emitStop: () => {},
      emitRewind: () => {},
      emitClear: () => {},
      syncWasmPlay: () => {},
      syncWasmPause: () => {},
      syncWasmStop: () => {},
    },
  }
);
