// src/effects/transportOrchestrator.ts
//
// Wires transport-machine lifecycle, runtime event listeners, mock-time clock
// policy, and mode synchronisation together in a single imperative start/stop
// API.  This replaces the side-effect code that previously lived inside
// TransportToolbar's onMount / createEffect hooks so it can run (and be
// tested) without mounting any Solid component.

import { createActor, type AnyActorRef } from "xstate";
import { Effect } from "effect";
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
import { applyClockPolicy, listenForHardwareOverride } from "./transportClock";

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
  sendRuntimeTransportCommand(command);

const play = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.play);
const pause = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.pause);
const stop = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.stop);
const rewind = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.rewind);
const clear = () => sendTransportCommand(SHARED_TRANSPORT_COMMANDS.clear);

// ── Types ───────────────────────────────────────────────────────

export interface TransportOrchestrator {
  /** The xstate actor backing the transport machine. */
  actor: AnyActorRef;
  /** Send an event to the transport machine. */
  send: (event: any) => void;
  /** Current snapshot accessor (for UI binding). */
  getSnapshot: () => any;
  /** Subscribe to actor state changes. Returns unsubscribe. */
  subscribe: (cb: (snapshot: any) => void) => { unsubscribe: () => void };
  /** Tear down all listeners and stop the actor. */
  dispose: () => void;
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
 * 4. Watch transport state transitions and apply mock-time clock policy.
 *
 * Returns an object with `actor`, `send`, `getSnapshot`, `subscribe`, and
 * `dispose`.  The UI component can bind directly to these without owning
 * any side-effects.
 */
export function createTransportOrchestrator(): TransportOrchestrator {
  // ── 1. Actor creation ──────────────────────────────────────────
  const machine = transportMachine.provide({
    actions: {
      emitPlay:     () => { Effect.runPromise(play()); },
      emitPause:    () => { Effect.runPromise(pause()); },
      emitStop:     () => { Effect.runPromise(stop()); },
      emitRewind:   () => { Effect.runPromise(rewind()); },
      emitClear:    () => { Effect.runPromise(clear()); },
      syncWasmPlay: () => { Effect.runPromise(syncRuntimeWasmTransportState("playing")).catch(() => undefined); },
      syncWasmPause:() => { Effect.runPromise(syncRuntimeWasmTransportState("paused")).catch(() => undefined); },
      syncWasmStop: () => { Effect.runPromise(syncRuntimeWasmTransportState("stopped")).catch(() => undefined); },
    },
  });
  const actor = createActor(machine);
  const send = (event: any) => actor.send(event);

  // ── 2. Transport-state → mock-time clock policy ────────────────
  let prevTransportState: TransportState = "playing";

  const actorSub = actor.subscribe((snapshot) => {
    const current = snapshot.value as TransportState;
    // Skip the initial snapshot (actor starts in "playing")
    if (current === prevTransportState) return;
    const prev = prevTransportState;
    prevTransportState = current;
    applyClockPolicy(current, prev);
  });

  // ── 3. Runtime-service subscriptions ───────────────────────────
  const refreshMode = (
    runtimeState: RuntimeSessionState = getRuntimeServiceSnapshot()
  ) => {
    send({ type: "UPDATE_MODE", mode: runtimeState.session.transportMode });
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
      Effect.runPromise(queryRuntimeHardwareTransportState()).then(syncState);
    }
  );

  const removeJsonMeta = jsonMetaChannel.subscribe(
    (detail: JsonMetaEventDetail) => {
      syncState(extractTransportStateFromMeta(detail));
    }
  );

  // ── Start ──────────────────────────────────────────────────────
  actor.start();

  // ── Dispose ────────────────────────────────────────────────────
  function dispose() {
    actorSub.unsubscribe();
    unsubRuntime();
    unsubHardwareOverride();
    removeProtocolReady();
    removeJsonMeta();
    actor.stop();
  }

  return {
    actor,
    send,
    getSnapshot: () => actor.getSnapshot(),
    subscribe: (cb) => actor.subscribe(cb),
    dispose,
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
 * Tear down the singleton (useful for tests or hot-module replacement).
 */
export function disposeTransportOrchestrator(): void {
  _instance?.dispose();
  _instance = null;
}
