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
import { executeAction } from "../keybindings/handlers";
import type { ActionId } from "../keybindings/actions";
import type { MenuDispatcher } from "../menu/dispatcher";
import * as ch from "../../contracts/gamepadChannels";
import { insertionModeField, structField } from "../../editors/extensions/structure/adapter/stateField.ts";
import { findById, isLeaf, type LeafKind } from "../../editors/extensions/structure/core/index.ts";
import { isGrabActive } from "./grabState.ts";
import { isMenuOpen } from "../menu/store.ts";

import { diffSnapshots } from "./hardware";
import { step, flush, INITIAL_STATE, DEFAULT_TIMING, type RecognizerState, type Timing } from "./recognizer";
import { resolveGesture, resolveAxis, buildLayerMap, activeStack } from "./resolver";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { radialLayer } from "./paradigms/radial";
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
   * Optional menu dispatcher for routing `menu.*` actions and axis events
   * from the radial-menu paradigm layer. When provided, menu actions go
   * directly to the dispatcher instead of legacy typed channels.
   */
  readonly menuDispatcher?: MenuDispatcher;
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
  menuDispatcher?: MenuDispatcher,
) {
  return function fireAction(action: ActionId): void {
    // Notify external observer (e.g. zen mode grid navigation) before
    // dispatching. The observer can read the action id and react.
    onAction?.(action);

    // Route menu.* actions to the menu dispatcher if available.
    if (menuDispatcher && action.startsWith("menu.")) {
      menuDispatcher.handleAction(action);
      return;
    }

    // Try keybinding handler first (covers eval, edit, probe, panel,
    // structural nav, etc.)
    if (executeAction(action, "gamepad", getEditor())) return;

    // Bridge to remaining typed channels for actions that still flow
    // through channel subscribers (eval, manual-control, etc.).
    switch (action) {
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
    radialLayer,
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

  // §6.2.5: LB and RB presses arriving within T_bothWindow are coalesced into
  // a single `both` shoulder edge. We buffer the first shoulder press and flush
  // it (as a single-side edge) once the window elapses with no partner press.
  const T_BOTH_WINDOW_MS = 25;
  let pendingShoulderPress: { side: "left" | "right"; ts: number } | null = null;

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
    let insertionMode = false;
    let cursorOnLeafAtom = false;
    let cursorNodeKind: string | null = null;

    if (editor) {
      // Read insertion mode from the dedicated state field.
      insertionMode = editor.state.field(insertionModeField, false) ?? false;

      // Read structural cursor state to determine if on a leaf atom.
      const sf = editor.state.field(structField, false);
      if (sf) {
        const primary = sf.state.cursors.primary;
        if (primary.kind === "node") {
          const node = findById(sf.state.tree.root, primary.target);
          if (node && isLeaf(node) && node.kind !== "document") {
            cursorOnLeafAtom = true;
            cursorNodeKind = node.kind as LeafKind;
          }
        }
      }
    }

    return {
      gamepad: getState(),
      insertionMode,
      cursorOnLeafAtom,
      cursorNodeKind,
      grabActive: isGrabActive(),
    };
  }

  const fireAction = createActionRunner(() => editor, options.onAction, options.menuDispatcher);

  const dispatcher: Dispatcher = createDispatcher({
    fireAction,
    publishAxis: (_channel: AxisChannelName, frame: AxisFrame) => {
      // Route menu axis channels to the menu dispatcher.
      if (
        options.menuDispatcher &&
        (_channel === "menu.left.angle" || _channel === "menu.right.angle")
      ) {
        const stick = _channel === "menu.left.angle" ? "left" as const : "right" as const;
        const mag = Math.sqrt(frame.x * frame.x + frame.y * frame.y);
        const ENGAGEMENT_THRESHOLD = 0.5;
        if (mag < ENGAGEMENT_THRESHOLD) {
          options.menuDispatcher.handleAxis(stick, null);
        } else {
          // Compute segment index from polar angle. Default 12 segments
          // per ring; the reducer clamps to the active tab's count.
          const angle = Math.atan2(frame.x, -frame.y); // 0 = north, CW positive
          const SEGMENTS = 12;
          const normalised = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const segment = Math.floor((normalised / (2 * Math.PI)) * SEGMENTS);
          options.menuDispatcher.handleAxis(stick, segment);
        }
        return;
      }
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

  // -- Shoulder freeze edges (radial-menu.md §3.3.2, §6.1, §6.2.5) ----------
  //
  // The radial menu's freeze mechanic is driven by RAW LB/RB press/release
  // edges, not by gestures or actions (§11.4: "freeze is a state transition
  // triggered by raw shoulder press/release events"). The gesture layer maps
  // LB/RB *taps* to tab-cycle actions; here we additionally forward the
  // underlying press/release edges to the dispatcher while the menu is open so
  // that holding a shoulder in `picking` latches a FrozenSnapshot.

  function mapShoulder(btn: string): "left" | "right" | null {
    if (btn === "LB") return "left";
    if (btn === "RB") return "right";
    return null;
  }

  function emitShoulderPress(side: "left" | "right", t: number): void {
    // §6.2.5: coalesce a near-simultaneous opposite-side press into `both`.
    if (
      pendingShoulderPress &&
      pendingShoulderPress.side !== side &&
      t - pendingShoulderPress.ts <= T_BOTH_WINDOW_MS
    ) {
      pendingShoulderPress = null;
      options.menuDispatcher?.handleShoulder("both", "press", t);
      return;
    }
    // Flush any stale pending press (different gesture, window expired) before
    // buffering the new one.
    flushPendingShoulder(t);
    pendingShoulderPress = { side, ts: t };
  }

  function flushPendingShoulder(t: number): void {
    if (
      pendingShoulderPress &&
      t - pendingShoulderPress.ts > T_BOTH_WINDOW_MS
    ) {
      const { side } = pendingShoulderPress;
      pendingShoulderPress = null;
      options.menuDispatcher?.handleShoulder(side, "press", t);
    }
  }

  function emitShoulderRelease(side: "left" | "right", t: number): void {
    // If the matching press is still buffered (released within the window),
    // flush it as a single-side press first so the edge pair is well-formed.
    if (pendingShoulderPress && pendingShoulderPress.side === side) {
      pendingShoulderPress = null;
      options.menuDispatcher?.handleShoulder(side, "press", t);
    }
    options.menuDispatcher?.handleShoulder(side, "release", t);
  }

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
      flushPendingShoulder(t);
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

      // Forward raw shoulder edges to the menu dispatcher's freeze mechanic
      // while the menu is open (§3.3.2 / §6.1). Done before gesture stepping
      // so the freeze latch is in place when the face-button tap resolves.
      if (options.menuDispatcher && isMenuOpen()) {
        const side =
          event.kind === "press" || event.kind === "release"
            ? mapShoulder(event.btn)
            : null;
        if (side !== null) {
          if (event.kind === "press") emitShoulderPress(side, t);
          else emitShoulderRelease(side, t);
        }
      }

      const out = step(recognizerState, event, timing);
      recognizerState = out.state;
      processGestures(out.gestures);
      processAxes(out.axes);
    }

    // Flush to capture any timers past the current tick
    flushPendingShoulder(t);
    const flushed = flush(recognizerState, t);
    recognizerState = flushed.state;
    processGestures(flushed.gestures);
  }

  function processGestures(gestures: readonly GestureEvent[]): void {
    for (const ge of gestures) {
      // Capture appState per-gesture so that side effects from dispatch
      // are visible to subsequent gestures in the same batch.
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
      manager.reset();
    },
  };
}

// Re-export commonly used types and constructors
export { keyOf, tap, hold, held, chord, flick, doubleTap, at } from "./gestures";
export type { Gesture, GestureEvent, LogicalEvent, AxisFrame, Layer, LayerName } from "./types";
export { radialLayer } from "./paradigms/radial";
export { modalShiftLayers } from "./paradigms/modal-shift";
export { leaderLayers, leaderTransientLayers } from "./paradigms/leader";
export { hydraLayers, hydraTransientLayers } from "./paradigms/hydra";
export { chordHeavyLayers } from "./paradigms/chord-heavy";
