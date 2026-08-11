/**
 * The Machine — subscriptions wiring real stores and channels to the
 * schematic.
 *
 * Spec: `docs/specs/the-machine.md` §2.2 (live behaviours, each mapped to its
 * real source) and §1.2 (the honesty rule).
 *
 * Every source below is a read of something the running app produces:
 *
 *   transport play/stop  → the transport machine actor (transportOrchestrator)
 *   evaluation           → `codeEvaluated` on the runtime channels
 *   per-output health    → `outputHealthStore` (fed by active diagnostics)
 *   output values        → the visualisation sampler's rolling past buffers
 *   clock phase/time     → `visualisationStore` (`bar`, `currentTime`)
 *
 * There is no timer, no rAF loop and no interpolation in this module. If the
 * app stops publishing, every accessor here stops changing. That is the whole
 * point: the schematic cannot animate without a real event.
 *
 * Each source is overridable so component tests can supply a real transport
 * actor / real sample buffer without booting the whole app
 * (the-machine.md §6.1 explicitly allows driving stores and channels
 * directly).
 */

import { createSignal, onCleanup, type Accessor } from "solid-js";

import { codeEvaluated } from "../../../contracts/runtimeChannels";
import { connectionChanged, settingsChanged } from "../../../contracts/runtimeChannels";
import { visualisationSession } from "../../../effects/visualisationSession";
import { peekTransportOrchestrator } from "../../../effects/transportOrchestrator";
import { getActiveWasmRuntimePort } from "../../../runtime/activeWasmRuntimePort";
import { outputHealth } from "../../../utils/outputHealthStore";
import type { OutputHealth } from "../../../utils/outputHealthStore";
import type { MachineClockState, SampleWindow } from "./machineModel";

// ---------------------------------------------------------------------------
// Source surface
// ---------------------------------------------------------------------------

/** Minimal read view of the transport actor the clock region follows. */
export interface TransportActorLike {
  getSnapshot(): { value: unknown };
  subscribe(listener: (snapshot: { value: unknown }) => void): {
    unsubscribe(): void;
  };
}

export interface MachineSources {
  /** Transport state, or "stopped" when no transport is running. */
  clockState: Accessor<MachineClockState>;
  /** Bar position in 0..1 as last reported by the sampler. */
  phase: Accessor<number>;
  /** Transport time in seconds as last reported by the sampler. */
  timeSeconds: Accessor<number>;
  /** Outputs registered with the visualisation store. */
  expressions: Accessor<
    Record<string, { expressionText: string; color: string | null }>
  >;
  /** Per-output health, projected from the engine's active diagnostics. */
  health: Accessor<Record<string, { health: OutputHealth; message?: string }>>;
  /** Rolling sample window for an output, or null when none exists. */
  sampleWindowFor: (output: string) => SampleWindow | null;
  /** Increments once per real evaluation event. */
  evalPulse: Accessor<number>;
  /** False when no runtime can report anything (hardware-only / no WASM). */
  live: Accessor<boolean>;
}

export interface MachineSourceOverrides {
  transportActor?: TransportActorLike | null;
  sampleWindowFor?: (output: string) => SampleWindow | null;
  isLive?: () => boolean;
}

// ---------------------------------------------------------------------------
// Real-source helpers
// ---------------------------------------------------------------------------

function toClockState(value: unknown): MachineClockState {
  return value === "playing" || value === "paused" || value === "stopped"
    ? value
    : "stopped";
}

/**
 * The runtime is "live" when the WASM port can actually evaluate. This is the
 * same capability probes gate on (probes.md §1.6.3), so the schematic and the
 * probes agree about when the app has nothing to say.
 */
function defaultIsLive(): boolean {
  try {
    const caps = getActiveWasmRuntimePort().capabilities();
    return Boolean(caps.enabled && caps.supportsEval);
  } catch {
    return false;
  }
}

/** Real past-sample buffer for an output, straight from the sampler. */
function defaultSampleWindowFor(output: string): SampleWindow | null {
  try {
    return visualisationSession.view.readOutput(output)?.pastBuffer ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the reactive source surface. Must be called inside a Solid owner —
 * every subscription is torn down via `onCleanup`.
 */
export function createMachineSources(
  overrides: MachineSourceOverrides = {},
): MachineSources {
  // ── Transport ────────────────────────────────────────────────────
  // `peek` rather than `get`: rendering the schematic must never create the
  // orchestrator (the-machine.md §1.3).
  const actor =
    overrides.transportActor !== undefined
      ? overrides.transportActor
      : (peekTransportOrchestrator()?.actor as TransportActorLike | undefined) ??
        null;

  const [clockState, setClockState] = createSignal<MachineClockState>(
    actor ? toClockState(actor.getSnapshot().value) : "stopped",
  );

  if (actor) {
    const sub = actor.subscribe((snapshot) => {
      setClockState(toClockState(snapshot.value));
    });
    onCleanup(() => sub.unsubscribe());
  }

  // ── Evaluation pulse ─────────────────────────────────────────────
  const [evalPulse, setEvalPulse] = createSignal(0);
  const unsubEval = codeEvaluated.subscribe(() => {
    setEvalPulse((n) => n + 1);
  });
  onCleanup(unsubEval);

  // ── Runtime availability ─────────────────────────────────────────
  const isLive = overrides.isLive ?? defaultIsLive;
  const [live, setLive] = createSignal(isLive());
  const refreshLive = () => setLive(isLive());
  const unsubConnection = connectionChanged.subscribe(refreshLive);
  const unsubSettings = settingsChanged.subscribe(refreshLive);
  const unsubEvalLive = codeEvaluated.subscribe(refreshLive);
  onCleanup(() => {
    unsubConnection();
    unsubSettings();
    unsubEvalLive();
  });

  return {
    clockState,
    phase: () => visualisationSession.state.bar,
    timeSeconds: () => visualisationSession.state.currentTime,
    expressions: () => visualisationSession.state.expressions,
    health: () => outputHealth,
    sampleWindowFor: overrides.sampleWindowFor ?? defaultSampleWindowFor,
    evalPulse,
    live,
  };
}
