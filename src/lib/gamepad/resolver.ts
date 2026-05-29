// src/lib/gamepad/resolver.ts
//
// Stage 3 of the gamepad pipeline: maps gestures and axis frames against
// the layer stack to produce Resolution records.
//
// Pure function: (gesture, state, layers) → Resolution | null
// No side effects, no store access, no timers. The dispatcher handles
// all impure concerns downstream.
//
// See docs/specs/gamepad.md §4 for the normative spec.

import { keyOf } from "./gestures";
import type {
  AppStateSnapshot,
  AxisChannelName,
  AxisFrame,
  DualBinding,
  Gesture,
  GestureKey,
  Layer,
  LayerName,
  MissPolicy,
  Resolution,
  StickName,
} from "./types";
import { isDualBinding } from "./types";

// ---------------------------------------------------------------------------
// Layer stack composition (spec §4.1)
// ---------------------------------------------------------------------------

export function activeStack(
  state: AppStateSnapshot,
  layers: readonly Layer[],
  layersByName: ReadonlyMap<LayerName, Layer>,
): readonly Layer[] {
  const transient = state.gamepad.transientLayers
    .map((t) => layersByName.get(t.name))
    .filter((l): l is Layer => l != null);

  const predicate = layers.filter((l) => !l.when || l.when(state));

  return [...transient, ...predicate];
}

// ---------------------------------------------------------------------------
// Gesture resolution (spec §4.1, §4.3, §4.5)
// ---------------------------------------------------------------------------

export function resolveGesture(
  gesture: Gesture,
  state: AppStateSnapshot,
  layers: readonly Layer[],
  layersByName: ReadonlyMap<LayerName, Layer>,
): Resolution | null {
  const stack = activeStack(state, layers, layersByName);
  const key = keyOf(gesture);

  for (const layer of stack) {
    // Leaders take precedence within their layer (spec §4.5.3)
    if (layer.leaders) {
      const leaderTarget = layer.leaders[key];
      if (leaderTarget !== undefined) {
        return {
          kind: "leader",
          layerName: leaderTarget,
          gesture,
        };
      }
    }

    if (layer.gestures) {
      const binding = layer.gestures[key];
      if (binding !== undefined) {
        if (isDualBinding(binding)) {
          return { kind: "dual", binding, gesture };
        }
        return { kind: "action", action: binding, gesture };
      }
    }

    // Transient layer miss handling (spec §4.7)
    const isTransient = state.gamepad.transientLayers.some(
      (t) => t.name === layer.name,
    );
    if (isTransient) {
      const policy = layer.onMiss ?? "fall-through";
      if (policy === "fall-through") continue;
      return { kind: "miss", gesture, policy };
    }

    // Exclusive (masking) predicate layer: a `when`-gated layer marked
    // `mask: true` takes over all input while active. An unbound gesture is
    // discarded rather than leaking to lower layers (radial-menu.md §1.1 /
    // §12.6). `onMiss` is honoured only for transient layers, so masking
    // predicate layers need this explicit stop.
    if (layer.mask) {
      return { kind: "miss", gesture, policy: layer.onMiss ?? "pop-and-discard" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Axis resolution (spec §4.6)
// ---------------------------------------------------------------------------

export function resolveAxis(
  frame: AxisFrame,
  state: AppStateSnapshot,
  layers: readonly Layer[],
  layersByName: ReadonlyMap<LayerName, Layer>,
): Resolution | null {
  const stack = activeStack(state, layers, layersByName);
  const side = stickSide(frame.stick);

  for (const layer of stack) {
    if (layer.axes) {
      const channel = layer.axes[side];
      if (channel !== undefined) {
        return {
          kind: "axis",
          channel,
          stick: frame.stick,
          frame,
        };
      }
    }
  }

  return null;
}

function stickSide(stick: StickName): "left" | "right" {
  return stick === "LeftStick" ? "left" : "right";
}

// ---------------------------------------------------------------------------
// Binding validation (spec §5.1, §3.2.3)
// ---------------------------------------------------------------------------

export type BindingLintError = {
  readonly layer: LayerName;
  readonly key: GestureKey;
  readonly message: string;
};

export function lintBindings(layers: readonly Layer[]): BindingLintError[] {
  const errors: BindingLintError[] = [];

  for (const layer of layers) {
    if (!layer.gestures) continue;

    const holdKeys = new Set<string>();
    const heldKeys = new Set<string>();

    for (const [key, binding] of Object.entries(layer.gestures)) {
      if (isDualBinding(binding)) {
        if (binding.hold !== undefined && binding.held !== undefined) {
          errors.push({
            layer: layer.name,
            key: key as GestureKey,
            message: "hold and held are mutually exclusive on the same button",
          });
        }
      }

      // Track hold/held keys by button for cross-key check.
      // A hold:A binding and a held:A binding in the same layer is also invalid,
      // even if they're separate entries rather than in the same DualBinding.
      if (key.startsWith("hold:")) holdKeys.add(key.slice(5));
      if (key.startsWith("held:")) heldKeys.add(key.slice(5));
    }

    for (const btn of holdKeys) {
      if (heldKeys.has(btn)) {
        errors.push({
          layer: layer.name,
          key: `hold:${btn}` as GestureKey,
          message: `button ${btn} has both hold and held bindings in the same layer`,
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Layer registry helper
// ---------------------------------------------------------------------------

export function buildLayerMap(
  layers: readonly Layer[],
): ReadonlyMap<LayerName, Layer> {
  const map = new Map<LayerName, Layer>();
  for (const l of layers) {
    map.set(l.name, l);
  }
  return map;
}
