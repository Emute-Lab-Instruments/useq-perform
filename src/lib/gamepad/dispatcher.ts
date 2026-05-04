// src/lib/gamepad/dispatcher.ts
//
// The single impure component in the gamepad pipeline. Receives
// Resolution records from the resolver (Stage 3) and:
//   - Dispatches actions through the action runner
//   - Applies eager-with-undo timing for dual-bound buttons
//   - Pushes/pops transient layers in the gamepad state
//   - Publishes axis frames to channels
//
// See docs/specs/gamepad.md §5 for eager-with-undo semantics.

import type {
  ActionId,
  AxisChannelName,
  AxisFrame,
  DualBinding,
  GamepadState,
  Gesture,
  LayerName,
  MissPolicy,
  Resolution,
  TransientLayerEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Dispatcher configuration (injected; no global singletons)
// ---------------------------------------------------------------------------

export type DispatcherConfig = {
  readonly fireAction: (action: ActionId) => void;
  readonly undo: () => void;
  readonly publishAxis: (channel: AxisChannelName, frame: AxisFrame) => void;
  readonly onLayerPush: (entry: TransientLayerEntry) => void;
  readonly onLayerPop: (name: LayerName) => void;
  readonly onNoopFlash: () => void;
  readonly getState: () => GamepadState;
  readonly now: () => number;
};

// ---------------------------------------------------------------------------
// Pending dual-binding timers
// ---------------------------------------------------------------------------

type PendingDual = {
  readonly gesture: Gesture;
  readonly binding: DualBinding;
  readonly firedTap: boolean;
  readonly timerId: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type Dispatcher = {
  dispatch(resolution: Resolution): void;
  dispose(): void;
};

export function createDispatcher(config: DispatcherConfig): Dispatcher {
  const pendingDuals = new Map<string, PendingDual>();

  function dualKey(g: Gesture): string {
    return g.kind === "tap" || g.kind === "hold" || g.kind === "held"
      ? g.btn
      : JSON.stringify(g);
  }

  function clearPending(key: string): void {
    const pending = pendingDuals.get(key);
    if (pending) {
      clearTimeout(pending.timerId);
      pendingDuals.delete(key);
    }
  }

  function dispatch(resolution: Resolution): void {
    switch (resolution.kind) {
      case "action": {
        config.fireAction(resolution.action);
        break;
      }

      case "dual": {
        handleDual(resolution.binding, resolution.gesture);
        break;
      }

      case "leader": {
        const layer = resolution.layerName;
        const ttlMs = 800; // default; overridden by layer.ttlMs in full wiring
        const now = config.now();
        config.onLayerPush({
          name: layer,
          pushedAt: now,
          expiresAt: now + ttlMs,
        });
        break;
      }

      case "axis": {
        config.publishAxis(resolution.channel, resolution.frame);
        break;
      }

      case "miss": {
        handleMiss(resolution.gesture, resolution.policy);
        break;
      }
    }
  }

  function handleDual(binding: DualBinding, gesture: Gesture): void {
    const key = dualKey(gesture);

    if (gesture.kind === "tap") {
      if (binding.tap) {
        config.fireAction(binding.tap);

        if (binding.hold) {
          // Eager-with-undo: fire tap eagerly, set timer for hold rollback
          const timerId = setTimeout(() => {
            config.undo();
            config.fireAction(binding.hold!);
            pendingDuals.delete(key);
          }, 250); // T_hold

          pendingDuals.set(key, {
            gesture,
            binding,
            firedTap: true,
            timerId,
          });
        }
      }
      return;
    }

    if (gesture.kind === "hold") {
      const pending = pendingDuals.get(key);
      if (pending) {
        // Eager-with-undo: timer hasn't fired yet, so handle it now.
        clearPending(key);
        config.undo();
        if (binding.hold) {
          config.fireAction(binding.hold);
        }
      }
      // If no pending entry, the setTimeout already handled the undo+hold
      // (or this dual has no tap, in which case no timer was set and we
      // must fire the hold directly).
      else if (!binding.tap && binding.hold) {
        config.fireAction(binding.hold);
      }
      return;
    }

    if (gesture.kind === "held") {
      // Held ticks fire alongside tap — no undo needed (spec §5.2.5)
      if (binding.held) {
        config.fireAction(binding.held);
      }
      return;
    }

    // For any other gesture kind hitting a dual binding, try the single
    // action that matches (shouldn't normally happen with well-formed bindings)
    if (binding.tap) config.fireAction(binding.tap);
  }

  function handleMiss(_gesture: Gesture, policy: MissPolicy): void {
    switch (policy) {
      case "fall-through":
        // Shouldn't reach the dispatcher — resolver handles this
        break;
      case "pop-and-fall-through": {
        const state = config.getState();
        const topTransient = state.transientLayers[0];
        if (topTransient) config.onLayerPop(topTransient.name);
        break;
      }
      case "pop-and-discard": {
        const state = config.getState();
        const topTransient = state.transientLayers[0];
        if (topTransient) config.onLayerPop(topTransient.name);
        break;
      }
      case "noop-flash": {
        const state = config.getState();
        const topTransient = state.transientLayers[0];
        if (topTransient) config.onLayerPop(topTransient.name);
        config.onNoopFlash();
        break;
      }
    }
  }

  function dispose(): void {
    for (const [, pending] of pendingDuals) {
      clearTimeout(pending.timerId);
    }
    pendingDuals.clear();
  }

  return { dispatch, dispose };
}
