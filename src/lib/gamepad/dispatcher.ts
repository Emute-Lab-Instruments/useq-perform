// src/lib/gamepad/dispatcher.ts
//
// The single impure component in the gamepad pipeline. Receives
// Resolution records from the resolver (Stage 3) and:
//   - Dispatches actions through the action runner
//   - Pushes/pops transient layers in the gamepad state
//   - Publishes axis frames to channels

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
  readonly publishAxis: (channel: AxisChannelName, frame: AxisFrame) => void;
  readonly onLayerPush: (entry: TransientLayerEntry) => void;
  readonly onLayerPop: (name: LayerName) => void;
  readonly onNoopFlash: () => void;
  readonly getState: () => GamepadState;
  readonly now: () => number;
};


// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type Dispatcher = {
  dispatch(resolution: Resolution): void;
  dispose(): void;
};

export function createDispatcher(config: DispatcherConfig): Dispatcher {

  // -----------------------------------------------------------------------
  // dispatch — main entry point
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // handleDual — dual-binding gesture dispatch
  // -----------------------------------------------------------------------

  function handleDual(binding: DualBinding, gesture: Gesture): void {
    switch (gesture.kind) {
      case "tap": {
        if (binding.tap) config.fireAction(binding.tap);
        break;
      }
      case "hold": {
        if (binding.hold) config.fireAction(binding.hold);
        break;
      }
      case "held": {
        if (binding.held) config.fireAction(binding.held);
        break;
      }
      // For other gesture kinds hitting a dual binding, try tap
      default: {
        if (binding.tap) config.fireAction(binding.tap);
      }
    }
  }

  // -----------------------------------------------------------------------
  // handleMiss — transient-layer miss policies
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // dispose — clean up
  // -----------------------------------------------------------------------

  function dispose(): void {
    // No timers or resources to clean up
  }

  return { dispatch, dispose };
}
