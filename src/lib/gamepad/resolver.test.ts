// src/lib/gamepad/resolver.test.ts
//
// Tests for Stage 3: the layer-stack resolver. All tests are pure —
// no DOM, no reactive context, no timers.

import { describe, expect, it } from "vitest";
import { chord, flick, held, hold, keyOf, tap } from "./gestures";
import {
  activeStack,
  buildLayerMap,
  lintBindings,
  resolveAxis,
  resolveGesture,
} from "./resolver";
import type {
  AppStateSnapshot,
  AxisChannelName,
  AxisFrame,
  DualBinding,
  GamepadState,
  Layer,
  LayerName,
  Resolution,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ln = (name: string) => name as LayerName;
const ch = (name: string) => name as AxisChannelName;

function mkState(overrides: Partial<GamepadState> = {}): AppStateSnapshot {
  return {
    gamepad: {
      heldButtons: new Set(),
      transientLayers: [],
      lastInputAt: 0,
      stickPositions: {
        LeftStick: { x: 0, y: 0 },
        RightStick: { x: 0, y: 0 },
      },
      ...overrides,
    },
  };
}

function mkFrame(
  stick: "LeftStick" | "RightStick",
  x: number,
  y: number,
  t = 0,
): AxisFrame {
  return { stick, x, y, t };
}

// ---------------------------------------------------------------------------
// Fixture layers
// ---------------------------------------------------------------------------

const globalLayer: Layer = {
  name: ln("global"),
  when: () => true,
  gestures: {
    [keyOf(tap("Start"))]: "eval.now",
    [keyOf(tap("A"))]: "edit.slurpFwd",
    [keyOf(tap("B"))]: "edit.barfFwd",
    [keyOf(held("Up"))]: "nav.up",
  },
  axes: { right: ch("manual-control") },
};

const radialFixtureLayer: Layer = {
  name: ln("radial-menu"),
  when: (s) => !!(s as Record<string, unknown>).menuOpen,
  gestures: {
    [keyOf(tap("A"))]: "menu.verb.insert",
    [keyOf(tap("B"))]: "menu.cancel",
  },
  axes: { left: ch("menu.left.angle"), right: ch("menu.right.angle") },
  onMiss: "pop-and-discard",
};

const dualBindLayer: Layer = {
  name: ln("dual"),
  when: () => true,
  gestures: {
    [keyOf(tap("X"))]: {
      tap: "edit.slurpFwd",
      hold: "eval.now",
    } satisfies DualBinding,
  },
};

const leaderBaseLayer: Layer = {
  name: ln("leader-base"),
  when: () => true,
  gestures: {
    [keyOf(tap("A"))]: "edit.slurpFwd",
  },
  leaders: {
    [keyOf(tap("Y"))]: ln("after-Y"),
  },
};

const afterYLayer: Layer = {
  name: ln("after-Y"),
  popOn: ["resolution", "timeout"],
  ttlMs: 800,
  onMiss: "pop-and-fall-through",
  gestures: {
    [keyOf(tap("A"))]: "edit.barfFwd",
    [keyOf(tap("B"))]: "edit.delete",
  },
};

// ---------------------------------------------------------------------------
// activeStack
// ---------------------------------------------------------------------------

describe("activeStack", () => {
  it("returns predicate-driven layers whose when() is true", () => {
    const layers = [globalLayer, radialFixtureLayer];
    const map = buildLayerMap(layers);
    const state = mkState();

    const stack = activeStack(state, layers, map);
    expect(stack.map((l) => l.name)).toEqual([ln("global")]);
  });

  it("includes layers whose when predicate passes", () => {
    const layers = [globalLayer, radialFixtureLayer];
    const map = buildLayerMap(layers);
    const state: AppStateSnapshot = { ...mkState(), menuOpen: true };

    const stack = activeStack(state, layers, map);
    expect(stack.map((l) => l.name)).toEqual([
      ln("global"),
      ln("radial-menu"),
    ]);
  });

  it("includes layers with no when predicate (always active)", () => {
    const alwaysLayer: Layer = {
      name: ln("always"),
      gestures: { [keyOf(tap("X"))]: "eval.now" },
    };
    const layers = [alwaysLayer];
    const map = buildLayerMap(layers);

    const stack = activeStack(mkState(), layers, map);
    expect(stack).toHaveLength(1);
    expect(stack[0].name).toBe(ln("always"));
  });

  it("prepends transient layers above predicate-driven layers", () => {
    const layers = [globalLayer];
    const allLayers = [globalLayer, afterYLayer];
    const map = buildLayerMap(allLayers);
    const state = mkState({
      transientLayers: [
        { name: ln("after-Y"), pushedAt: 100, expiresAt: 900 },
      ],
    });

    const stack = activeStack(state, layers, map);
    expect(stack.map((l) => l.name)).toEqual([
      ln("after-Y"),
      ln("global"),
    ]);
  });

  it("skips transient entries with no matching layer definition", () => {
    const layers = [globalLayer];
    const map = buildLayerMap(layers);
    const state = mkState({
      transientLayers: [
        { name: ln("nonexistent"), pushedAt: 0, expiresAt: null },
      ],
    });

    const stack = activeStack(state, layers, map);
    expect(stack.map((l) => l.name)).toEqual([ln("global")]);
  });
});

// ---------------------------------------------------------------------------
// resolveGesture — basic resolution
// ---------------------------------------------------------------------------

describe("resolveGesture", () => {
  const layers = [globalLayer, radialFixtureLayer];
  const map = buildLayerMap([...layers, afterYLayer, leaderBaseLayer]);

  it("resolves a gesture to an action in the first matching layer", () => {
    const result = resolveGesture(tap("Start"), mkState(), layers, map);
    expect(result).toEqual({
      kind: "action",
      action: "eval.now",
      gesture: tap("Start"),
    });
  });

  it("returns null when no layer binds the gesture", () => {
    const result = resolveGesture(tap("LT"), mkState(), layers, map);
    expect(result).toBeNull();
  });

  it("resolves held gestures", () => {
    const result = resolveGesture(held("Up", 3), mkState(), layers, map);
    expect(result).toEqual({
      kind: "action",
      action: "nav.up",
      gesture: held("Up", 3),
    });
  });

  it("higher layers shadow lower layers", () => {
    // Picker before global — declaration order = priority order
    const priorityLayers = [radialFixtureLayer, globalLayer];
    const m = buildLayerMap(priorityLayers);
    const state: AppStateSnapshot = { ...mkState(), menuOpen: true };
    const result = resolveGesture(tap("A"), state, priorityLayers, m);
    expect(result).toEqual({
      kind: "action",
      action: "menu.verb.insert",
      gesture: tap("A"),
    });
  });

  it("falls through to lower layers when higher layer doesn't bind", () => {
    const priorityLayers = [radialFixtureLayer, globalLayer];
    const m = buildLayerMap(priorityLayers);
    const state: AppStateSnapshot = { ...mkState(), menuOpen: true };
    const result = resolveGesture(tap("Start"), state, priorityLayers, m);
    expect(result).toEqual({
      kind: "action",
      action: "eval.now",
      gesture: tap("Start"),
    });
  });
});

// ---------------------------------------------------------------------------
// resolveGesture — dual bindings
// ---------------------------------------------------------------------------

describe("resolveGesture — dual bindings", () => {
  const layers = [dualBindLayer];
  const map = buildLayerMap(layers);

  it("resolves a dual binding as kind:dual", () => {
    const result = resolveGesture(tap("X"), mkState(), layers, map);
    expect(result).toEqual({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("X"),
    });
  });
});

// ---------------------------------------------------------------------------
// resolveGesture — leaders
// ---------------------------------------------------------------------------

describe("resolveGesture — leaders", () => {
  const layers = [leaderBaseLayer];
  const map = buildLayerMap([...layers, afterYLayer]);

  it("leader bindings produce kind:leader resolution", () => {
    const result = resolveGesture(tap("Y"), mkState(), layers, map);
    expect(result).toEqual({
      kind: "leader",
      layerName: ln("after-Y"),
      gesture: tap("Y"),
    });
  });

  it("leaders take precedence over gesture bindings in the same layer", () => {
    const layerWithBoth: Layer = {
      name: ln("both"),
      when: () => true,
      gestures: { [keyOf(tap("Y"))]: "eval.now" },
      leaders: { [keyOf(tap("Y"))]: ln("after-Y") },
    };
    const ls = [layerWithBoth];
    const m = buildLayerMap([...ls, afterYLayer]);
    const result = resolveGesture(tap("Y"), mkState(), ls, m);
    expect(result?.kind).toBe("leader");
  });
});

// ---------------------------------------------------------------------------
// resolveGesture — transient layer miss handling
// ---------------------------------------------------------------------------

describe("resolveGesture — transient layer miss", () => {
  it("pop-and-fall-through: returns miss when gesture not bound in transient layer", () => {
    const layers = [globalLayer];
    const map = buildLayerMap([...layers, afterYLayer]);
    const state = mkState({
      transientLayers: [
        { name: ln("after-Y"), pushedAt: 100, expiresAt: 900 },
      ],
    });

    // tap('Start') is not bound in afterYLayer
    const result = resolveGesture(tap("Start"), state, layers, map);
    expect(result).toEqual({
      kind: "miss",
      gesture: tap("Start"),
      policy: "pop-and-fall-through",
    });
  });

  it("resolves normally when gesture IS bound in transient layer", () => {
    const layers = [globalLayer];
    const map = buildLayerMap([...layers, afterYLayer]);
    const state = mkState({
      transientLayers: [
        { name: ln("after-Y"), pushedAt: 100, expiresAt: 900 },
      ],
    });

    const result = resolveGesture(tap("A"), state, layers, map);
    expect(result).toEqual({
      kind: "action",
      action: "edit.barfFwd",
      gesture: tap("A"),
    });
  });

  it("fall-through transient layers continue to lower layers", () => {
    const transientFallthrough: Layer = {
      name: ln("fallthrough-t"),
      onMiss: "fall-through",
      gestures: { [keyOf(tap("X"))]: "eval.now" },
    };
    const layers = [globalLayer];
    const map = buildLayerMap([...layers, transientFallthrough]);
    const state = mkState({
      transientLayers: [
        { name: ln("fallthrough-t"), pushedAt: 0, expiresAt: null },
      ],
    });

    const result = resolveGesture(tap("Start"), state, layers, map);
    expect(result).toEqual({
      kind: "action",
      action: "eval.now",
      gesture: tap("Start"),
    });
  });

  it("pop-and-discard: returns miss with pop-and-discard policy", () => {
    const hydraLayer: Layer = {
      name: ln("hydra"),
      popOn: ["miss-or-cancel", "timeout"],
      onMiss: "pop-and-discard",
      gestures: { [keyOf(tap("Right"))]: "edit.slurpFwd" },
    };
    const layers = [globalLayer];
    const map = buildLayerMap([...layers, hydraLayer]);
    const state = mkState({
      transientLayers: [
        { name: ln("hydra"), pushedAt: 0, expiresAt: 2000 },
      ],
    });

    const result = resolveGesture(tap("LT"), state, layers, map);
    expect(result).toEqual({
      kind: "miss",
      gesture: tap("LT"),
      policy: "pop-and-discard",
    });
  });

  it("noop-flash: returns miss with noop-flash policy", () => {
    const flashLayer: Layer = {
      name: ln("flash"),
      onMiss: "noop-flash",
      gestures: {},
    };
    const layers = [globalLayer];
    const map = buildLayerMap([...layers, flashLayer]);
    const state = mkState({
      transientLayers: [
        { name: ln("flash"), pushedAt: 0, expiresAt: null },
      ],
    });

    const result = resolveGesture(tap("A"), state, layers, map);
    expect(result).toEqual({
      kind: "miss",
      gesture: tap("A"),
      policy: "noop-flash",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAxis
// ---------------------------------------------------------------------------

describe("resolveAxis", () => {
  const layers = [globalLayer, radialFixtureLayer];
  const map = buildLayerMap(layers);

  it("resolves right stick to channel from the topmost binding layer", () => {
    const frame = mkFrame("RightStick", 0.5, 0.3);
    const result = resolveAxis(frame, mkState(), layers, map);
    expect(result).toEqual({
      kind: "axis",
      channel: ch("manual-control"),
      stick: "RightStick",
      frame,
    });
  });

  it("higher layers shadow lower axis bindings", () => {
    const priorityLayers = [radialFixtureLayer, globalLayer];
    const m = buildLayerMap(priorityLayers);
    const state: AppStateSnapshot = { ...mkState(), menuOpen: true };
    const frame = mkFrame("RightStick", 0.5, 0.3);
    const result = resolveAxis(frame, state, priorityLayers, m);
    expect(result).toEqual({
      kind: "axis",
      channel: ch("menu.right.angle"),
      stick: "RightStick",
      frame,
    });
  });

  it("resolves left stick when bound", () => {
    const state: AppStateSnapshot = { ...mkState(), menuOpen: true };
    const frame = mkFrame("LeftStick", -0.8, 0);
    const result = resolveAxis(frame, state, layers, map);
    expect(result).toEqual({
      kind: "axis",
      channel: ch("menu.left.angle"),
      stick: "LeftStick",
      frame,
    });
  });

  it("returns null when no layer binds the stick", () => {
    const frame = mkFrame("LeftStick", 0.5, 0.3);
    const result = resolveAxis(frame, mkState(), layers, map);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lintBindings
// ---------------------------------------------------------------------------

describe("lintBindings", () => {
  it("returns empty for valid bindings", () => {
    expect(lintBindings([globalLayer])).toEqual([]);
  });

  it("flags hold+held in the same DualBinding", () => {
    const bad: Layer = {
      name: ln("bad"),
      gestures: {
        [keyOf(tap("A"))]: {
          hold: "eval.now",
          held: "edit.slurpFwd",
        } as DualBinding,
      },
    };
    const errors = lintBindings([bad]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("mutually exclusive");
  });

  it("flags hold and held as separate keys for the same button", () => {
    const bad: Layer = {
      name: ln("bad"),
      gestures: {
        [keyOf(hold("A"))]: "eval.now",
        [keyOf(held("A"))]: "edit.slurpFwd",
      },
    };
    const errors = lintBindings([bad]);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.message.includes("both hold and held"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// buildLayerMap
// ---------------------------------------------------------------------------

describe("buildLayerMap", () => {
  it("builds a map keyed by layer name", () => {
    const map = buildLayerMap([globalLayer, radialFixtureLayer]);
    expect(map.get(ln("global"))).toBe(globalLayer);
    expect(map.get(ln("radial-menu"))).toBe(radialFixtureLayer);
    expect(map.size).toBe(2);
  });
});
