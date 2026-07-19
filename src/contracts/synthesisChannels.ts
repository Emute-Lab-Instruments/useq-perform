/**
 * Typed channels and store contract for synthesis engine state.
 *
 * Fulfils (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-ENGINE-021 — indicator and engine state flow through props without
 *                    singleton imports (the indicator reads a snapshot
 *                    delivered as props via an adapter; runtime consumers
 *                    read the engine state from the typed channels/store
 *                    below, never from the service singleton directly).
 *   VAL-ENGINE-036 — main-thread boundaries use typed channels; no editor-
 *                    to-worklet shortcut or main-thread live-control
 *                    executor bypasses the service boundary.
 *   VAL-HOST-011   — capability/engine telemetry snapshots are immutable.
 *
 * Architecture notes:
 *
 * - This module is the single place where synthesis-engine state changes
 *   are published. UI adapters subscribe to {@link engineStateChanged} and
 *   pass snapshots down as props; runtime consumers (producer wiring,
 *   eval-to-engine commit, recovery) read the {@link engineStateStore}
 *   Solid store directly. Nothing imports the service singleton except
 *   bootstrap wiring.
 *
 * - Following the typed-channel convention (`docs/specs/reactive-flow.md`),
 *   engine state does NOT use CustomEvents. The service is the only
 *   publisher, and every consumer subscribes via the channel or store.
 *
 * - All snapshot objects published here are frozen so devmode telemetry
 *   surfaces can hand them to debug tools without worrying about mutation
 *   (VAL-HOST-011 read-only telemetry invariant).
 */

import { createChannel, type TypedChannel } from "../lib/typedChannel";
import { createStore } from "solid-js/store";

// ---------------------------------------------------------------------------
// Engine state — the four-state lifecycle contract (VAL-ENGINE-016)
// ---------------------------------------------------------------------------

/**
 * The four finite synthesis-engine lifecycle states.
 *
 * Off:        capability absent or no AudioContext has ever been created.
 *             Audio path is inert; the editor and ordinary eval work.
 * Suspended:  AudioContext exists but is suspended awaiting user activation.
 *             Audio path is wired but produces no samples. The transport-
 *             family indicator offers a clickable recovery affordance.
 * Running:    AudioContext is running, the worklet is rendering, and the
 *             producer is publishing controls into the SAB.
 * Error:      A fault (producer loss, worklet trap, overload) has silenced
 *             the engine. A recovery affordance reinitialises failed
 *             resources exactly once.
 *
 * Transitions are finite and exact; see {@link ENGINE_TRANSITIONS} and
 * `src/audio/synthesisService.ts` for the state-machine contract.
 */
export type SynthesisEngineState = "off" | "suspended" | "running" | "error";

/**
 * Actionable reason for the current state, when not part of normal lifecycle.
 *
 * Stable machine-readable keys (the public telemetry surface) plus a
 * human-readable explanation. The key surface is stable so dashboards and
 * tests can match without parsing prose; the prose is for the indicator
 * tooltip.
 */
export const ENGINE_STATE_REASONS = Object.freeze({
  NO_AUDIO_CAPABILITY:
    "Audio is unavailable in this browser. See the capability snapshot for the missing requirement.",
  AWAITING_USER_ACTIVATION:
    "Audio is suspended. Click the indicator or press any key to enable sound.",
  PRODUCER_TIMEOUT:
    "The control producer stopped responding. Output has been faded to silence.",
  WORKLET_TRAP:
    "The audio worklet reported a trap. Output has been faded to silence.",
  OVERLOAD:
    "The audio thread missed its deadline repeatedly. Output has been faded to silence.",
  RECOVERY_FAILED:
    "Engine reinitialisation failed. Reload the page to retry.",
} as const);

export type EngineStateReasonKey = keyof typeof ENGINE_STATE_REASONS;

/**
 * Full engine state snapshot published on every transition.
 *
 * Frozen at publication time so subscribers (UI adapters, telemetry
 * consumers) cannot mutate the canonical state (VAL-HOST-011).
 */
export interface EngineStateSnapshot {
  /** Current four-state engine state. */
  readonly state: SynthesisEngineState;
  /**
   * Stable machine-readable reason key for the current state, or `null`
   * when the state is part of normal lifecycle (off with no capability,
   * suspended on first creation, running, etc.).
   */
  readonly reasonKey: EngineStateReasonKey | null;
  /** Human-readable message for the indicator tooltip. */
  readonly reasonMessage: string | null;
  /** Monotonic counter incremented on every transition. */
  readonly transitionCount: number;
  /** Wall-clock millis (`Date.now()`) of the most recent transition. */
  readonly transitionedAt: number;
}

// ---------------------------------------------------------------------------
// Channel — engine state transitions
// ---------------------------------------------------------------------------

export const ENGINE_TRANSITION_EVENT = "useq-engine-state-changed";

/** Channel published exactly once per engine state transition. */
export const engineStateChanged: TypedChannel<EngineStateSnapshot> =
  createChannel<EngineStateSnapshot>();

// ---------------------------------------------------------------------------
// Solid store — reactive engine state for non-UI consumers
// ---------------------------------------------------------------------------

/**
 * Solid store mirror of the latest engine state. The synthesis service is
 * the sole writer; every other consumer reads. UI adapters typically
 * subscribe to {@link engineStateChanged} instead, but the store is useful
 * for effects modules that already own a Solid reactive root.
 */
export interface EngineStateStore {
  readonly current: EngineStateSnapshot;
}

const INITIAL_ENGINE_STATE: EngineStateSnapshot = Object.freeze({
  state: "off",
  reasonKey: null,
  reasonMessage: null,
  transitionCount: 0,
  transitionedAt: 0,
});

export const [engineStateStore, setEngineStateStore] =
  createStore<EngineStateStore>({
    current: INITIAL_ENGINE_STATE,
  });

/**
 * Publish an engine state snapshot through every canonical surface:
 *   - the typed channel (subscribers: UI adapters, telemetry);
 *   - the Solid store (subscribers: effects modules).
 *
 * The synthesis service is the sole intended caller. The snapshot is
 * deep-frozen at the boundary so downstream code cannot mutate canonical
 * state. The CALLER'S object is not mutated; a shallow copy is frozen
 * and installed in the store (VAL-HOST-011 immutability invariant).
 */
export function publishEngineState(snapshot: EngineStateSnapshot): void {
  // Copy before freezing so the caller can keep using their object
  // (e.g. they may want to publish a slightly different variant later).
  const frozen = Object.freeze({ ...snapshot });
  setEngineStateStore({ current: frozen });
  engineStateChanged.publish(frozen);
}

/**
 * Test-only helper: reset the engine state store to its initial value.
 * Tests use this between cases so earlier service instances do not bleed
 * state. The production service publishes a fresh snapshot on bootstrap.
 */
export function resetEngineStateStoreForTests(): void {
  setEngineStateStore({ current: INITIAL_ENGINE_STATE });
}

// ---------------------------------------------------------------------------
// Finite transition matrix (VAL-ENGINE-016)
// ---------------------------------------------------------------------------

/**
 * The complete, exact transition matrix for the four-state lifecycle.
 *
 * Every allowed transition is listed; any transition not present is
 * forbidden. The synthesis service consults this map before applying a
 * transition and throws (or, in recovery paths, returns `false`) when a
 * requested transition is forbidden.
 *
 * Trigger keys describe what input causes the transition; they are
 * consumed by tests and devmode telemetry, never by user-facing strings
 * (use {@link ENGINE_STATE_REASONS} for those).
 *
 * Note on `error → error`: this self-loop is a real transition (the
 * recovery-failed path), distinct from a no-op resume attempt. The
 * service emits a transition count increment and a fresh lifecycle event
 * each time recovery fails, so dashboards can count distinct recovery
 * attempts. Other self-loops (e.g. `running → running`) are no-ops and
 * are forbidden — the state machine has exactly one self-loop entry.
 *
 * `off → suspended` is the only way out of `off`: a fatal fault during
 * bring-up first transitions to `suspended` (AudioContext created) and
 * THEN to `error` (worklet addModule or module compilation failed), so
 * the matrix forbids a direct `off → error` jump. This keeps the
 * transition graph acyclic-apart-from-the-error-self-loop.
 */
export const ENGINE_TRANSITIONS = Object.freeze({
  off: Object.freeze({
    suspended: "engine-create",
  } as const),
  suspended: Object.freeze({
    running: "user-activation",
    off: "engine-dispose",
    error: "fatal-before-running",
  } as const),
  running: Object.freeze({
    suspended: "audio-suspend",
    error: "producer-loss",
    off: "engine-dispose",
  } as const),
  error: Object.freeze({
    suspended: "recovery-succeeded",
    off: "engine-dispose",
    error: "recovery-failed",
  } as const),
} as const);

/**
 * Trigger keys allowed for transitions. Mirrored from
 * {@link ENGINE_TRANSITIONS} for the state-machine tests; the service
 * emits the trigger key on each transition so tests can assert that the
 * transition was caused by the expected input.
 *
 * The type is widened to `string` because TypeScript's per-row frozen
 * object literal union does not unify cleanly across the four state
 * rows. The values are still drawn from the matrix; runtime callers
 * receive one of the documented trigger strings.
 */
export type EngineTransitionTrigger = string;

/**
 * Return true iff a transition from `from` to `to` is allowed by the
 * finite contract in {@link ENGINE_TRANSITIONS}.
 *
 * The `error → error` recovery-failed self-loop is the one permitted
 * self-transition (so dashboards can count distinct recovery failures).
 * Every other self-loop is a forbidden no-op.
 */
export function isAllowedEngineTransition(
  from: SynthesisEngineState,
  to: SynthesisEngineState,
): boolean {
  const row = ENGINE_TRANSITIONS[from];
  if (!Object.prototype.hasOwnProperty.call(row, to)) {
    return false;
  }
  // The error → error self-loop is the only permitted self-transition.
  if (from === to && !(from === "error" && to === "error")) {
    return false;
  }
  return true;
}

/**
 * Return the trigger key that causes the transition `from → to`, or
 * `null` when the transition is forbidden.
 */
export function engineTransitionTrigger(
  from: SynthesisEngineState,
  to: SynthesisEngineState,
): EngineTransitionTrigger | null {
  if (!isAllowedEngineTransition(from, to)) return null;
  const row = ENGINE_TRANSITIONS[from] as Record<string, EngineTransitionTrigger>;
  return row[to] ?? null;
}

// ---------------------------------------------------------------------------
// Lifecycle event channel — recovery/telemetry audit trail
// ---------------------------------------------------------------------------

/**
 * Lifecycle event published on every transition in addition to the
 * snapshot. Useful for telemetry dashboards that want a flat audit trail
 * rather than a Solid store subscription.
 */
export interface EngineLifecycleEvent {
  /** Transition counter at the time of the event. */
  readonly transitionCount: number;
  /** Source state. */
  readonly from: SynthesisEngineState;
  /** Destination state. */
  readonly to: SynthesisEngineState;
  /** Trigger key that caused the transition. */
  readonly trigger: EngineTransitionTrigger;
  /** Wall-clock millis (`Date.now()`) of the transition. */
  readonly at: number;
}

export const ENGINE_LIFECYCLE_EVENT = "useq-engine-lifecycle";
export const engineLifecycle: TypedChannel<EngineLifecycleEvent> =
  createChannel<EngineLifecycleEvent>();

// ---------------------------------------------------------------------------
// Re-export
// ---------------------------------------------------------------------------

export type { TypedChannel };
