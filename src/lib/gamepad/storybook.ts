// src/lib/gamepad/storybook.ts
//
// Tiny utility module for Storybook stories that want to drive themselves
// from real-hardware gamepad input. Keeps a strict zero-coupling boundary:
// no imports from src/ui/, src/runtime/, src/effects/, src/editors/, or
// src/transport/. Pure consumer of src/lib/gamepad/.
//
// Three exports:
//
//   useGamepadSnapshot()    — Solid signal of the live gamepad snapshot
//                             (polls navigator.getGamepads()).
//   useGamepadPipeline()    — Stand up the same recognizer + resolver
//                             pipeline that the production code uses,
//                             but instrumented to expose its event
//                             stream (LogicalEvents, GestureEvents,
//                             resolved ActionIds, AxisFrames). Stories
//                             that want resolved actions to actually fire
//                             pass a `fireAction` callback.
//   onGamepadConnect()      — Subscribe to the browser's `gamepadconnected`
//                             event with a normalised payload.
//
// Implementation note: we deliberately do NOT import the production
// `createGamepadPipeline` from `./index.ts`. That entry point pulls in
// the keybinding handler registry which transitively imports `effects/`,
// `ui/`, and `editors/` modules — initialising them at module-load time
// breaks Storybook's vite environment and the unit-test harness. Instead
// the helper composes the same pure primitives (`diffSnapshots`, `step`,
// `flush`, `resolveGesture`, `resolveAxis`) into an equivalent loop, so
// stories can observe a faithful pipeline without dragging the whole app
// into Storybook's bundle.
//
// Hot-reload-safe: no module-scope intervals, no singleton state. All
// resources are created per-call and torn down on Solid `onCleanup` or
// the returned `dispose()`.

import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { EditorView } from "@codemirror/view";

import {
  createGamepadManager,
  cloneSnapshot,
  type GamepadManager,
  type GamepadSnapshot,
} from "./gamepadManager";
import { diffSnapshots } from "./hardware";
import {
  step,
  flush,
  INITIAL_STATE,
  DEFAULT_TIMING,
  type RecognizerState,
  type Timing,
} from "./recognizer";
import {
  resolveGesture,
  resolveAxis,
  buildLayerMap,
} from "./resolver";
import { radialLayer } from "./paradigms/radial";
import { modalShiftLayers } from "./paradigms/modal-shift";
import {
  leaderLayers,
  leaderTransientLayers,
} from "./paradigms/leader";
import {
  hydraLayers,
  hydraTransientLayers,
} from "./paradigms/hydra";
import { chordHeavyLayers } from "./paradigms/chord-heavy";

import type {
  ActionId,
  AxisFrame,
  ButtonName,
  GamepadState,
  GestureEvent,
  Layer,
  LogicalEvent,
  TransientLayerEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Paradigm =
  | "modal-shift"
  | "leader"
  | "hydra"
  | "chord-heavy";

/** Discriminated record emitted by the parallel pipeline observer. */
export type PipelineEvent =
  | { readonly kind: "logical"; readonly event: LogicalEvent; readonly t: number }
  | { readonly kind: "gesture"; readonly gesture: GestureEvent; readonly t: number }
  | { readonly kind: "action"; readonly action: ActionId; readonly t: number }
  | { readonly kind: "axis"; readonly frame: AxisFrame; readonly t: number };

export interface UseGamepadPipelineOptions {
  /**
   * Optional editor that the helper dispatches resolved actions into.
   * The helper does not import the keybinding handler registry directly
   * (that pulls in transport / ui / editors at module-load time, which
   * breaks Storybook's bundle and the unit-test harness). Instead, pass
   * an explicit `fireAction` callback for stories that want real
   * action dispatch — typically `(action) => executeAction(action, "gamepad", editor)`.
   */
  readonly editor?: EditorView;
  /**
   * Optional callback invoked with each resolved ActionId. Use this to
   * forward actions into the real keybinding handler registry from
   * stories that need behaviour. The helper still records actions in
   * its event stream regardless.
   */
  readonly fireAction?: (action: ActionId, editor?: EditorView) => void;
  /** Which layer paradigm to load. Defaults to "modal-shift". */
  readonly paradigm?: Paradigm;
  /**
   * Optional manager injection. Useful in tests; in the browser the
   * helper builds a fresh GamepadManager from `navigator.getGamepads`.
   */
  readonly gamepadManager?: GamepadManager;
  /** Polling cadence for the observer tick. */
  readonly pollIntervalMs?: number;
  /** Clock injection, default `performance.now`. */
  readonly now?: () => number;
  /** Recognizer timing overrides (mostly useful for tests). */
  readonly timing?: Partial<Timing>;
  /** Cap on the rolling event tail. Defaults to 200. */
  readonly maxEvents?: number;
}

export interface UseGamepadPipelineResult {
  readonly events: Accessor<readonly PipelineEvent[]>;
  /** Stops the pipeline and tears down recorders. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// useGamepadSnapshot
// ---------------------------------------------------------------------------

const DEFAULT_POLL_MS = 50;
const DEFAULT_MAX_EVENTS = 200;

interface UseGamepadSnapshotOptions {
  readonly pollIntervalMs?: number;
  /** Inject `navigator.getGamepads` for tests. */
  readonly getGamepads?: () => ArrayLike<Gamepad | null>;
}

/**
 * A Solid signal that polls `navigator.getGamepads()` on a fixed cadence
 * and exposes the first connected gamepad's normalised snapshot, or `null`
 * when nothing is connected. Cleanup is automatic on Solid scope dispose.
 */
export function useGamepadSnapshot(
  options: UseGamepadSnapshotOptions = {},
): Accessor<GamepadSnapshot | null> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const [snap, setSnap] = createSignal<GamepadSnapshot | null>(null);

  const manager = createGamepadManager({
    getGamepads:
      options.getGamepads ??
      (() => {
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.getGamepads === "function"
        ) {
          return navigator.getGamepads();
        }
        return [];
      }),
  });
  manager.connect();

  const tick = (): void => {
    const next = manager.poll();
    setSnap(next && next.connected ? next : null);
  };

  // Run one tick immediately so a connected pad surfaces without delay.
  tick();
  const id = setInterval(tick, pollIntervalMs);

  onCleanup(() => {
    clearInterval(id);
    manager.disconnect();
    manager.reset();
  });

  return snap;
}

// ---------------------------------------------------------------------------
// useGamepadPipeline
// ---------------------------------------------------------------------------

function layersForParadigm(
  paradigm: Paradigm,
): { layers: readonly Layer[]; transientLayers: readonly Layer[] } {
  switch (paradigm) {
    case "leader":
      return {
        layers: [radialLayer, ...leaderLayers],
        transientLayers: leaderTransientLayers,
      };
    case "hydra":
      return {
        layers: [radialLayer, ...hydraLayers],
        transientLayers: hydraTransientLayers,
      };
    case "chord-heavy":
      return {
        layers: [radialLayer, ...chordHeavyLayers],
        transientLayers: [],
      };
    case "modal-shift":
    default:
      return {
        layers: [radialLayer, ...modalShiftLayers],
        transientLayers: [],
      };
  }
}

/**
 * Stand up an instrumented gamepad pipeline using the same pure
 * primitives as the production `createGamepadPipeline` (`diffSnapshots`,
 * `step`/`flush`, `resolveGesture`/`resolveAxis`) and expose its event
 * stream as a reactive signal. Stories that want resolved actions to
 * actually fire (against the keybinding handler registry, an editor,
 * etc.) supply a `fireAction` callback — the helper itself stays
 * boundary-clean and import-free of higher layers.
 */
export function useGamepadPipeline(
  options: UseGamepadPipelineOptions = {},
): UseGamepadPipelineResult {
  const now = options.now ?? (() => performance.now());
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timing: Timing = { ...DEFAULT_TIMING, ...options.timing };
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const paradigm: Paradigm = options.paradigm ?? "modal-shift";

  const manager =
    options.gamepadManager ??
    createGamepadManager({
      getGamepads: () => {
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.getGamepads === "function"
        ) {
          return navigator.getGamepads();
        }
        return [];
      },
    });

  const { layers, transientLayers } = layersForParadigm(paradigm);
  const fireAction = options.fireAction;
  const editor = options.editor;

  // -- Observer / pipeline tick -------------------------------------------
  const [events, setEvents] = createSignal<readonly PipelineEvent[]>([]);

  const layerMap = buildLayerMap([...layers, ...transientLayers]);

  // Lightweight gamepad-state mirror for resolution. The observer doesn't
  // push transient layers (the real pipeline does that) — so for predicate
  // resolution we rely on layers' `when` predicates that don't read
  // observer-only state. This is enough for the visualisation use-case.
  const observerHeld = new Set<ButtonName>();
  const observerSticks: Record<"LeftStick" | "RightStick", { x: number; y: number }> = {
    LeftStick: { x: 0, y: 0 },
    RightStick: { x: 0, y: 0 },
  };
  let observerLastInputAt = 0;

  function getObserverState(): GamepadState {
    return {
      heldButtons: new Set(observerHeld),
      transientLayers: [] as readonly TransientLayerEntry[],
      lastInputAt: observerLastInputAt,
      stickPositions: {
        LeftStick: { ...observerSticks.LeftStick },
        RightStick: { ...observerSticks.RightStick },
      },
    };
  }

  function getObserverAppState() {
    return { gamepad: getObserverState(), menuOpen: false };
  }

  let observerState: RecognizerState = INITIAL_STATE;
  let prevSnapshot: GamepadSnapshot | null = null;

  function push(event: PipelineEvent): void {
    setEvents((prev) => {
      const next = prev.length >= maxEvents
        ? [...prev.slice(prev.length - maxEvents + 1), event]
        : [...prev, event];
      return next;
    });
  }

  function emitAction(action: ActionId, t: number): void {
    push({ kind: "action", action, t });
    if (fireAction) {
      try {
        fireAction(action, editor);
      } catch {
        // Observer must never throw out of the polling loop.
      }
    }
  }

  function recordGestures(gestures: readonly GestureEvent[], t: number): void {
    for (const ge of gestures) {
      push({ kind: "gesture", gesture: ge, t });
      const resolution = resolveGesture(
        ge.gesture,
        getObserverAppState(),
        layers,
        layerMap,
      );
      if (!resolution) continue;
      if (resolution.kind === "action") {
        emitAction(resolution.action, t);
      } else if (resolution.kind === "dual") {
        // Eager-with-undo: surface the tap action immediately when one is
        // bound. The hold variant fires after T_hold; the helper keeps the
        // simpler eager-tap-only model since stories don't need precise
        // undo timing.
        if (resolution.binding.tap) {
          emitAction(resolution.binding.tap, t);
        } else if (resolution.binding.hold) {
          emitAction(resolution.binding.hold, t);
        }
      }
    }
  }

  function recordAxes(axes: readonly AxisFrame[], t: number): void {
    for (const frame of axes) {
      push({ kind: "axis", frame, t });
      const resolution = resolveAxis(
        frame,
        getObserverAppState(),
        layers,
        layerMap,
      );
      if (resolution && resolution.kind === "action") {
        emitAction(resolution.action, t);
      }
    }
  }

  function observerTick(): void {
    const snapshot = manager.poll();
    if (!snapshot?.connected) {
      prevSnapshot = null;
      observerState = INITIAL_STATE;
      return;
    }

    if (!prevSnapshot) {
      prevSnapshot = cloneSnapshot(snapshot)!;
      return;
    }

    const t = now();
    const logical = diffSnapshots(prevSnapshot, snapshot, t);
    prevSnapshot = cloneSnapshot(snapshot)!;

    if (logical.length === 0) {
      const flushed = flush(observerState, t);
      observerState = flushed.state;
      recordGestures(flushed.gestures, t);
      return;
    }

    observerLastInputAt = t;

    for (const event of logical) {
      push({ kind: "logical", event, t });
      if (event.kind === "press") {
        observerHeld.add(event.btn);
      } else if (event.kind === "release") {
        observerHeld.delete(event.btn);
      } else if (event.kind === "axis") {
        observerSticks[event.stick] = { x: event.x, y: event.y };
      }

      const out = step(observerState, event, timing);
      observerState = out.state;
      recordGestures(out.gestures, t);
      recordAxes(out.axes, t);
    }

    const flushed = flush(observerState, t);
    observerState = flushed.state;
    recordGestures(flushed.gestures, t);
  }

  const observerId = setInterval(observerTick, pollIntervalMs);
  // Run once immediately to initialise prevSnapshot if hardware is present.
  observerTick();

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInterval(observerId);
    if (!options.gamepadManager) {
      // Only tear down the manager if we created it ourselves.
      manager.disconnect();
      manager.reset();
    }
  }

  // Make sure we connect any locally-owned manager so it can register
  // browser-level connect/disconnect listeners.
  if (!options.gamepadManager) {
    manager.connect();
  }

  onCleanup(dispose);

  return { events, dispose };
}

// ---------------------------------------------------------------------------
// onGamepadConnect
// ---------------------------------------------------------------------------

/**
 * Subscribe to the browser's `gamepadconnected` event. The callback
 * receives a normalised `GamepadSnapshot` matching the rest of the
 * gamepad pipeline's contract. Returns a disposer.
 */
export function onGamepadConnect(
  cb: (snap: GamepadSnapshot) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event): void => {
    const e = event as GamepadEvent;
    const pad = e.gamepad;
    if (!pad) return;

    const snap: GamepadSnapshot = {
      connected: Boolean(pad.connected),
      id: pad.id ?? "",
      index: typeof pad.index === "number" ? pad.index : null,
      timestamp:
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now(),
      buttons: {},
      axes: {},
    };

    // Normalise buttons by index — the helper consumer can map to names
    // via gamepadManager's BUTTON_MAP if it wants, but a connect event
    // only needs to confirm presence, not full state.
    const rawButtons = pad.buttons ?? [];
    for (let i = 0; i < rawButtons.length; i += 1) {
      const b = rawButtons[i];
      snap.buttons[`Button${i}`] = {
        pressed: Boolean(b?.pressed),
        value: typeof b?.value === "number" ? b.value : 0,
      };
    }

    const rawAxes = pad.axes ?? [];
    for (let i = 0; i < rawAxes.length; i += 1) {
      snap.axes[`Axis${i}`] = typeof rawAxes[i] === "number" ? rawAxes[i] : 0;
    }

    cb(snap);
  };

  window.addEventListener("gamepadconnected", handler);
  return () => {
    window.removeEventListener("gamepadconnected", handler);
  };
}
