// src/lib/gamepad/dispatcher.ts
//
// The single impure component in the gamepad pipeline. Receives
// Resolution records from the resolver (Stage 3) and:
//   - Dispatches actions through the action runner
//   - Applies eager-with-undo timing for dual-bound buttons (spec §5.2)
//   - Defers non-reversible taps when a hold peer exists (spec §5.2.2)
//   - Pushes/pops transient layers in the gamepad state
//   - Publishes axis frames to channels
//
// See docs/specs/gamepad.md §5 for eager-with-undo semantics.

import { isReversible } from "../keybindings/actions";
import type {
  ActionId,
  AxisChannelName,
  AxisFrame,
  ButtonName,
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

/** Default hold threshold in ms (spec §3.2.2: T_hold). */
const DEFAULT_HOLD_MS = 250;

export type DispatcherConfig = {
  readonly fireAction: (action: ActionId) => void;
  readonly undo: () => void;
  readonly publishAxis: (channel: AxisChannelName, frame: AxisFrame) => void;
  readonly onLayerPush: (entry: TransientLayerEntry) => void;
  readonly onLayerPop: (name: LayerName) => void;
  readonly onNoopFlash: () => void;
  readonly getState: () => GamepadState;
  readonly now: () => number;
  /** Hold threshold in ms. Defaults to 250 (spec §3.2.2). */
  readonly holdMs?: number;
};

// ---------------------------------------------------------------------------
// Pending dual-binding state
// ---------------------------------------------------------------------------

/**
 * Discriminant for what kind of pending dual-binding is active.
 * - "eager": tap was fired eagerly (reversible action); timer will undo + fire hold
 * - "deferred": tap was NOT fired (non-reversible action); timer will fire hold
 *               without undo; release fires the deferred tap
 */
type PendingKind = "eager" | "deferred";

type PendingDual = {
  readonly kind: PendingKind;
  readonly gesture: Gesture;
  readonly binding: DualBinding;
  readonly timerId: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type Dispatcher = {
  dispatch(resolution: Resolution): void;
  /** Notify the dispatcher that a button was released. Used for deferred
   *  tap commitment: a non-reversible tap that was held back pending the
   *  hold timer is fired now if the timer hasn't expired yet. */
  notifyRelease(btn: ButtonName): void;
  dispose(): void;
};

export function createDispatcher(config: DispatcherConfig): Dispatcher {
  const holdMs = config.holdMs ?? DEFAULT_HOLD_MS;
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
  // notifyRelease — button release for deferred tap commitment
  // -----------------------------------------------------------------------

  function notifyRelease(btn: ButtonName): void {
    const key = btn;
    const pending = pendingDuals.get(key);
    if (!pending) return;

    if (pending.kind === "deferred" && pending.binding.tap) {
      // Button released before hold timer expired → fire the deferred tap
      clearPending(key);
      config.fireAction(pending.binding.tap);
    }
    // For "eager" pending: timer cancellation is already handled by
    // clearPending when the hold gesture arrives from the recognizer.
    // If the button is released before the timer fires, the timer's
    // callback will find no entry and be a no-op.
    // However, we should clear it to be clean:
    if (pending.kind === "eager") {
      clearPending(key);
    }
  }

  // -----------------------------------------------------------------------
  // handleDual — dual-binding gesture dispatch
  // -----------------------------------------------------------------------

  function handleDual(binding: DualBinding, gesture: Gesture): void {
    const key = dualKey(gesture);

    if (gesture.kind === "tap") {
      handleDualTap(binding, gesture, key);
      return;
    }

    if (gesture.kind === "hold") {
      handleDualHold(binding, gesture, key);
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

  // -----------------------------------------------------------------------
  // handleDualTap — spec §5.2.1 and §5.2.2
  // -----------------------------------------------------------------------

  function handleDualTap(
    binding: DualBinding,
    gesture: Gesture,
    key: string,
  ): void {
    if (!binding.tap) return;

    const hasHoldPeer = binding.hold !== undefined;

    // No hold peer → fire immediately regardless of reversibility (§5.2.1)
    if (!hasHoldPeer) {
      config.fireAction(binding.tap);
      return;
    }

    // Hold peer exists — check reversibility to decide eager vs deferred
    const reversible = isReversible(binding.tap);

    if (reversible) {
      // Eager-with-undo (spec §5.2.2): fire tap eagerly, start hold timer.
      // If timer expires: undo tap, fire hold.
      // If released before timer: tap stands committed (notifyRelease clears the timer).
      config.fireAction(binding.tap);

      const timerId = setTimeout(() => {
        // Timer expired while button still held → undo + fire hold
        if (pendingDuals.has(key)) {
          config.undo();
          config.fireAction(binding.hold!);
          pendingDuals.delete(key);
        }
        // If entry was already removed (release happened), this is a no-op.
      }, holdMs);

      pendingDuals.set(key, {
        kind: "eager",
        gesture,
        binding,
        timerId,
      });
    } else {
      // Non-reversible + hold peer → deferred tap.
      // DON'T fire tap yet. Start hold timer.
      // If timer expires: fire hold (no undo needed, tap never fired).
      // If released before timer: fire tap now (notifyRelease handles this).

      const timerId = setTimeout(() => {
        // Timer expired while button still held → fire hold, discard tap
        if (pendingDuals.has(key)) {
          config.fireAction(binding.hold!);
          pendingDuals.delete(key);
        }
      }, holdMs);

      pendingDuals.set(key, {
        kind: "deferred",
        gesture,
        binding,
        timerId,
      });
    }
  }

  // -----------------------------------------------------------------------
  // handleDualHold — recognizer's hold gesture arrived
  // -----------------------------------------------------------------------

  function handleDualHold(
    binding: DualBinding,
    _gesture: Gesture,
    key: string,
  ): void {
    const pending = pendingDuals.get(key);
    if (pending) {
      // Recognizer emitted hold before our timer fired — handle now.
      clearPending(key);

      if (pending.kind === "eager") {
        // Tap was already fired eagerly → undo it, then fire hold
        config.undo();
        if (binding.hold) {
          config.fireAction(binding.hold);
        }
      } else {
        // Deferred: tap was never fired → just fire hold
        if (binding.hold) {
          config.fireAction(binding.hold);
        }
      }
    } else {
      // No pending entry — either the setTimeout already handled it, or
      // this dual has no tap. Fire hold directly.
      if (binding.hold) {
        config.fireAction(binding.hold);
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
  // dispose — clean up all pending timers
  // -----------------------------------------------------------------------

  function dispose(): void {
    for (const [, pending] of pendingDuals) {
      clearTimeout(pending.timerId);
    }
    pendingDuals.clear();
  }

  return { dispatch, notifyRelease, dispose };
}
