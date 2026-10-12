// src/effects/transportOrchestrator.ts
//
// Wires transport-machine lifecycle, runtime event listeners, clock
// policy, and mode synchronisation together in a single imperative start/stop
// API.  This replaces the side-effect code that previously lived inside
// TransportToolbar's onMount / createEffect hooks so it can run (and be
// tested) without mounting any Solid component.

import { createActor, type ActorRefFrom } from "xstate";
import { transportMachine, type TransportState } from "../machines/transport.machine";
import {
  SHARED_TRANSPORT_COMMANDS,
  type SharedTransportCommand,
} from "../contracts/useqRuntimeContract";
import type { JsonMetaEventDetail } from "../contracts/runtimeChannels";
import {
  protocolReady as protocolReadyChannel,
  jsonMeta as jsonMetaChannel,
} from "../contracts/runtimeChannels";
import {
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
  sendRuntimeTransportCommand,
  queryRuntimeHardwareTransportState,
  syncRuntimeWasmTransportState,
  type RuntimeSessionState,
} from "../runtime/runtimeService";
import { updateRuntimeWasmAudioTransport } from "../runtime/runtimeTransportService";
import { applyClockPolicy, listenForHardwareOverride, restoreClockAfterHardwareDisconnect } from "./transportClock";

// ── Pure helpers ─────────────────────────────────────────────────

/**
 * Parse a raw transport state string from hardware into a typed TransportState.
 * Returns null if the value is unrecognized.
 */
export function parseTransportState(raw: string): TransportState | null {
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

/**
 * Extract transport state from a useq-json-meta event's detail.
 */
export function extractTransportStateFromMeta(
  detail: JsonMetaEventDetail
): TransportState | null {
  const meta = detail?.response?.meta;
  if (meta && typeof meta.transport === "string") {
    return parseTransportState(meta.transport);
  }
  return null;
}

// ── Transport command helpers (call runtimeService directly) ─────

const sendTransportCommand = (command: SharedTransportCommand) =>
  Promise.resolve().then(() => sendRuntimeTransportCommand(command)).catch((error) => {
    console.error("Transport command failed", error);
  });

const play = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.play);
const pause = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.pause);
const stop = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.stop);
const rewind = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.rewind);
const clear = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.clear);

// ── Types ───────────────────────────────────────────────────────

type TransportActor = ActorRefFrom<typeof transportMachine>;

export interface TransportOrchestrator {
  /** The xstate actor backing the transport machine. */
  actor: TransportActor;
  /** Send an event to the transport machine. */
  send: TransportActor["send"];
  /** Current snapshot accessor (for UI binding). */
  getSnapshot: TransportActor["getSnapshot"];
  /** Subscribe to actor state changes. Returns unsubscribe. */
  subscribe: (cb: (snapshot: ReturnType<TransportActor["getSnapshot"]>) => void) => { unsubscribe: () => void };
  /** Tear down all listeners and stop the actor. */
  dispose: () => void;
  /** Start browser-local playback while retaining the startup paused state. */
  startBrowserLocalRuntime: () => void;
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create and start the transport orchestrator.
 *
 * Responsibilities:
 * 1. Provide the transport machine with real effect actions (play/pause/stop
 *    etc.) and start the xstate actor.
 * 2. Subscribe to the runtime service for mode changes and hardware-override.
 * 3. Listen for PROTOCOL_READY and JSON_META runtime events to sync the
 *    machine with hardware state.
 * 4. Watch transport state transitions and apply clock policy.
 *
 * Returns an object with `actor`, `send`, `getSnapshot`, `subscribe`, and
 * `dispose`.  The UI component can bind directly to these without owning
 * any side-effects.
 */
export function createTransportOrchestrator(): TransportOrchestrator {
  let audioTransportState: TransportState = "paused";
  const playAudioTransport = () => {
    const transition = audioTransportState === "stopped" ? "start" : "resume";
    audioTransportState = "playing";
    void updateRuntimeWasmAudioTransport(transition);
  };
  const pauseAudioTransport = () => {
    audioTransportState = "paused";
    void updateRuntimeWasmAudioTransport("pause");
  };
  const stopAudioTransport = () => {
    audioTransportState = "stopped";
    void updateRuntimeWasmAudioTransport("stop");
  };

  // ── 1. Actor creation ──────────────────────────────────────────
  const machine = transportMachine.provide({
    actions: {
      emitPlay:     () => { void play(); playAudioTransport(); },
      emitPause:    () => { void pause(); pauseAudioTransport(); },
      emitStop:     () => { void stop(); stopAudioTransport(); },
      emitRewind:   () => { void rewind(); },
      emitClear:    () => { void clear(); },
      autoStartBrowserLocal: () => {
        void play();
        playAudioTransport();
        applyClockPolicy("playing", "stopped");
      },
      syncWasmPlay: () => {
        void syncRuntimeWasmTransportState("playing");
        playAudioTransport();
      },
      syncWasmPause:() => {
        void syncRuntimeWasmTransportState("paused");
        pauseAudioTransport();
      },
      syncWasmStop: () => {
        void syncRuntimeWasmTransportState("stopped");
        stopAudioTransport();
      },
    },
  });
  const actor = createActor(machine);
  const send: TransportActor["send"] = (event) => actor.send(event);

  // ── 2. Transport-state → clock policy ──────────────────────────
  // Machine boots in "paused" (spec §1.1). The no-runtime boot case is driven
  // to "stopped" below via an initial SYNC once the mode is known.
  let prevTransportState: TransportState = "paused";
  let browserLocalAutoRun = false;

  const actorSub = actor.subscribe((snapshot) => {
    const current = snapshot.value as TransportState;
    // Skip the initial snapshot (actor starts in "paused")
    if (current === prevTransportState) return;
    const prev = prevTransportState;
    prevTransportState = current;
    if (current !== "paused") browserLocalAutoRun = false;
    applyClockPolicy(current, prev);
  });

  // ── 3. Runtime-service subscriptions ───────────────────────────
  let lastMode = getRuntimeServiceSnapshot().session.transportMode;
  const refreshMode = (
    runtimeState: RuntimeSessionState = getRuntimeServiceSnapshot()
  ) => {
    const previousMode = lastMode;
    const mode = runtimeState.session.transportMode;
    lastMode = mode;
    send({ type: "UPDATE_MODE", mode });
    if ((previousMode === "hardware" || previousMode === "both") && mode === "wasm") {
      // Hardware time stops owning the clock on disconnect. Reapply policy
      // using the current machine state so WASM resumes, freezes, or resets
      // according to the transport state without requiring a user transition.
      restoreClockAfterHardwareDisconnect(
        mode,
        browserLocalAutoRun ? "playing" : actor.getSnapshot().value as TransportState,
      );
      void updateRuntimeWasmAudioTransport("reanchor");
    }
  };

  // Set initial mode before starting the actor
  refreshMode();

  const unsubRuntime = subscribeRuntimeService((runtimeState) => {
    refreshMode(runtimeState);
  });

  const unsubHardwareOverride = listenForHardwareOverride();

  // ── 4. Runtime event listeners ─────────────────────────────────
  const syncState = (transportState: TransportState | null) => {
    if (transportState) {
      send({ type: "SYNC", state: transportState });
    }
  };

  const removeProtocolReady = protocolReadyChannel.subscribe(
    () => {
      queryRuntimeHardwareTransportState().then(syncState);
    }
  );

  const removeJsonMeta = jsonMetaChannel.subscribe(
    (detail: JsonMetaEventDetail) => {
      syncState(extractTransportStateFromMeta(detail));
    }
  );

  // ── Start ──────────────────────────────────────────────────────
  actor.start();

  // Spec §1.1: boot in "paused" if a runtime is available, else "stopped".
  // The machine's initial state is "paused"; drive it to "stopped" via a
  // (non-emitting) SYNC when no runtime is available at boot.
  if (getRuntimeServiceSnapshot().session.transportMode === "none") {
    send({ type: "SYNC", state: "stopped" });
  }

  // ── Dispose ────────────────────────────────────────────────────
  function dispose() {
    actorSub.unsubscribe();
    unsubRuntime();
    unsubHardwareOverride();
    removeProtocolReady();
    removeJsonMeta();
    actor.stop();
  }

  function startBrowserLocalRuntime() {
    if (getRuntimeServiceSnapshot().session.transportMode !== "wasm") return;
    if (actor.getSnapshot().value === "stopped") {
      send({ type: "SYNC", state: "paused" });
    }
    browserLocalAutoRun = true;
    send({ type: "AUTO_START_BROWSER_LOCAL" });
  }

  return {
    actor,
    send,
    getSnapshot: () => actor.getSnapshot(),
    subscribe: (cb) => actor.subscribe(cb),
    dispose,
    startBrowserLocalRuntime,
  };
}

// ── Singleton (lazy) ────────────────────────────────────────────

let _instance: TransportOrchestrator | null = null;

/**
 * Get or create the singleton transport orchestrator.
 * The UI toolbar and any other consumer should call this rather than
 * creating their own actor.
 */
export function getTransportOrchestrator(): TransportOrchestrator {
  if (!_instance) {
    _instance = createTransportOrchestrator();
  }
  return _instance;
}

/**
 * Read the singleton **without creating it**.
 *
 * Read-only observers (the Machine schematic, the-machine.md §1.3: "never
 * causes engine activity") must not bring the orchestrator into existence as
 * a side effect of being rendered — creating it subscribes to the runtime
 * service and starts applying clock policy. `null` means transport has not
 * been started yet, which observers render as "no transport".
 */
export function peekTransportOrchestrator(): TransportOrchestrator | null {
  return _instance;
}

/**
 * Tear down the singleton (useful for tests or hot-module replacement).
 */
export function disposeTransportOrchestrator(): void {
  _instance?.dispose();
  _instance = null;
}
