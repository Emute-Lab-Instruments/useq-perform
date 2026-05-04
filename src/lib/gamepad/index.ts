// src/lib/gamepad/index.ts
//
// Full gamepad pipeline wiring. Connects all three stages + dispatcher
// into a running system. Canonical gamepad entry point.
//
// Usage in bootstrap.ts:
//   const gamepad = createGamepadPipeline({ editor });
//   gamepad.start();
//
// See docs/specs/gamepad.md for the full spec.

import type { EditorView } from "@codemirror/view";
import {
  createGamepadManager,
  cloneSnapshot,
  type GamepadManager,
  type GamepadSnapshot,
} from "./gamepadManager";
import { getHandler, type ActionHandler } from "../keybindings/handlers";
import type { ActionId } from "../keybindings/actions";
import * as ch from "../../contracts/gamepadChannels";

import { diffSnapshots } from "./hardware";
import { step, flush, INITIAL_STATE, DEFAULT_TIMING, type RecognizerState, type Timing } from "./recognizer";
import { resolveGesture, resolveAxis, buildLayerMap, activeStack } from "./resolver";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { pickerLayer } from "./paradigms/picker";
import { modalShiftLayers } from "./paradigms/modal-shift";
import type {
  AxisChannelName,
  AxisFrame,
  GamepadState,
  GestureEvent,
  Layer,
  LayerName,
  TransientLayerEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type GamepadPipelineOptions = {
  readonly editor?: EditorView;
  readonly gamepadManager?: GamepadManager;
  readonly now?: () => number;
  readonly pollIntervalMs?: number;
  readonly timing?: Partial<Timing>;
  readonly layers?: readonly Layer[];
  readonly transientLayers?: readonly Layer[];
  /**
   * Optional observer called for every fired ActionId. Used by surfaces
   * (e.g. zen mode grid) that want to react to gamepad-resolved actions
   * without subscribing to a typed channel. Fires before the action
   * handler runs.
   */
  readonly onAction?: (action: ActionId) => void;
};

export interface GamepadPipeline {
  start(): void;
  stop(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Action runner — bridges ActionId to handlers + legacy channels
// ---------------------------------------------------------------------------

function createActionRunner(
  getEditor: () => EditorView | undefined,
  onAction?: (action: ActionId) => void,
) {
  return function fireAction(action: ActionId): void {
    // Notify external observer (e.g. zen mode grid navigation) before
    // dispatching. The observer can read the action id and react.
    onAction?.(action);

    // Try keybinding handler first (covers eval, edit, probe, panel,
    // structural nav, etc.)
    const handler = getHandler(action);
    if (handler) {
      const editor = getEditor();
      if (handler.length > 0) {
        if (editor) (handler as (v: EditorView) => boolean)(editor);
      } else {
        (handler as () => boolean)();
      }
      return;
    }

    // Bridge to remaining typed channels for menu / picker actions that
    // still flow through channel subscribers. Tracks G/H will retire these.
    switch (action) {
      case "menu.openBefore":
        ch.openMenu.publish({ direction: "before" });
        break;
      case "menu.openAfter":
        ch.openMenu.publish({ direction: "after" });
        break;
      case "menu.radial":
        ch.openRadialMenu.publish({ direction: "replace" });
        break;
      case "picker.up":
        ch.pickerNavigate.publish({ direction: "up" });
        break;
      case "picker.down":
        ch.pickerNavigate.publish({ direction: "down" });
        break;
      case "picker.left":
        ch.pickerNavigate.publish({ direction: "left" });
        break;
      case "picker.right":
        ch.pickerNavigate.publish({ direction: "right" });
        break;
      case "picker.select":
        ch.pickerSelect.publish({});
        break;
      case "picker.cancel":
        ch.pickerCancel.publish({});
        break;
      default:
        break;
    }
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function createGamepadPipeline(
  options: GamepadPipelineOptions = {},
): GamepadPipeline {
  const now = options.now ?? (() => performance.now());
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const timing: Timing = { ...DEFAULT_TIMING, ...options.timing };

  const manager =
    options.gamepadManager ??
    createGamepadManager({
      getGamepads: () => navigator.getGamepads(),
    });

  // Layer configuration
  const predicateLayers: readonly Layer[] = options.layers ?? [
    pickerLayer,
    ...modalShiftLayers,
  ];
  const allTransientLayers: readonly Layer[] = options.transientLayers ?? [];
  const allLayers = [...predicateLayers, ...allTransientLayers];
  const layerMap = buildLayerMap(allLayers);

  // Mutable state
  let recognizerState: RecognizerState = INITIAL_STATE;
  let prevSnapshot: GamepadSnapshot | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let editor: EditorView | undefined = options.editor;
  let menuOpen = false;

  // Track controller mode from the menu bridge so the picker layer
  // activates when a menu is open.
  const unsubMode = ch.controllerMode.subscribe((mode) => {
    menuOpen = mode === "picker" || mode === "number-picker" || mode === "loading-picker";
  });

  const gamepadState: {
    heldButtons: Set<string>;
    transientLayers: TransientLayerEntry[];
    lastInputAt: number;
    stickPositions: Record<string, { x: number; y: number }>;
  } = {
    heldButtons: new Set(),
    transientLayers: [],
    lastInputAt: 0,
    stickPositions: {
      LeftStick: { x: 0, y: 0 },
      RightStick: { x: 0, y: 0 },
    },
  };

  function getState(): GamepadState {
    return {
      heldButtons: new Set(gamepadState.heldButtons) as ReadonlySet<import("./types").ButtonName>,
      transientLayers: [...gamepadState.transientLayers],
      lastInputAt: gamepadState.lastInputAt,
      stickPositions: {
        LeftStick: { ...gamepadState.stickPositions.LeftStick },
        RightStick: { ...gamepadState.stickPositions.RightStick },
      },
    };
  }

  function getAppState() {
    return {
      gamepad: getState(),
      menuOpen,
    };
  }

  const fireAction = createActionRunner(() => editor, options.onAction);

  function doUndo(): void {
    if (!editor) return;
    const handler = getHandler("edit.undo");
    if (handler) (handler as (v: EditorView) => boolean)(editor);
  }

  const dispatcher: Dispatcher = createDispatcher({
    fireAction,
    undo: doUndo,
    publishAxis: (_channel: AxisChannelName, frame: AxisFrame) => {
      ch.stickAxis.publish({
        stick: frame.stick === "LeftStick" ? "left" : "right",
        x: frame.x,
        y: frame.y,
      });
    },
    onLayerPush: (entry: TransientLayerEntry) => {
      gamepadState.transientLayers = [
        entry,
        ...gamepadState.transientLayers,
      ];
    },
    onLayerPop: (name: LayerName) => {
      gamepadState.transientLayers =
        gamepadState.transientLayers.filter((t) => t.name !== name);
    },
    onNoopFlash: () => {
      // TODO: visual feedback for unmatched gestures
    },
    getState,
    now,
  });

  // -- Tick -----------------------------------------------------------------

  function tick(): void {
    const snapshot = manager.poll();
    if (!snapshot?.connected) {
      prevSnapshot = null;
      recognizerState = INITIAL_STATE;
      // Clear stale gamepad state so reconnection starts clean
      gamepadState.heldButtons.clear();
      gamepadState.transientLayers = [];
      gamepadState.stickPositions.LeftStick = { x: 0, y: 0 };
      gamepadState.stickPositions.RightStick = { x: 0, y: 0 };
      return;
    }

    if (!prevSnapshot) {
      prevSnapshot = cloneSnapshot(snapshot)!;
      return;
    }

    const t = now();
    const events = diffSnapshots(prevSnapshot, snapshot, t);
    prevSnapshot = cloneSnapshot(snapshot)!;

    if (events.length === 0) {
      // Still flush to advance timers
      const flushed = flush(recognizerState, t);
      recognizerState = flushed.state;
      processGestures(flushed.gestures);
      return;
    }

    gamepadState.lastInputAt = t;

    for (const event of events) {
      // Update heldButtons from press/release
      if (event.kind === "press") {
        gamepadState.heldButtons.add(event.btn);
      } else if (event.kind === "release") {
        gamepadState.heldButtons.delete(event.btn);
      }

      const out = step(recognizerState, event, timing);
      recognizerState = out.state;
      processGestures(out.gestures);
      processAxes(out.axes);
    }

    // Flush to capture any timers past the current tick
    const flushed = flush(recognizerState, t);
    recognizerState = flushed.state;
    processGestures(flushed.gestures);
  }

  function processGestures(gestures: readonly GestureEvent[]): void {
    for (const ge of gestures) {
      // Capture appState per-gesture so that side effects from dispatch
      // (e.g. menuOpen flipping via controllerMode channel) are visible
      // to subsequent gestures in the same batch.
      const appState = getAppState();
      const resolution = resolveGesture(
        ge.gesture,
        appState,
        predicateLayers,
        layerMap,
      );
      if (resolution) dispatcher.dispatch(resolution);
    }
  }

  function processAxes(axes: readonly AxisFrame[]): void {
    for (const frame of axes) {
      const appState = getAppState();
      const resolution = resolveAxis(frame, appState, predicateLayers, layerMap);
      if (resolution) dispatcher.dispatch(resolution);
    }
  }

  // -- Lifecycle ------------------------------------------------------------

  return {
    start(): void {
      if (started) return;
      started = true;
      manager.connect();
      intervalId = setInterval(tick, pollIntervalMs);
      tick();
    },

    stop(): void {
      if (!started) return;
      started = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      manager.disconnect();
    },

    dispose(): void {
      this.stop();
      dispatcher.dispose();
      unsubMode();
      manager.reset();
    },
  };
}

// Re-export commonly used types and constructors
export { keyOf, tap, hold, held, chord, flick, doubleTap, at } from "./gestures";
export type { Gesture, GestureEvent, LogicalEvent, AxisFrame, Layer, LayerName } from "./types";
export { pickerLayer } from "./paradigms/picker";
export { modalShiftLayers } from "./paradigms/modal-shift";
export { leaderLayers, leaderTransientLayers } from "./paradigms/leader";
export { hydraLayers, hydraTransientLayers } from "./paradigms/hydra";
export { chordHeavyLayers } from "./paradigms/chord-heavy";
