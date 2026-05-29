// src/lib/gamepad/dispatcher.test.ts
//
// Tests for the dispatcher — the single impure gamepad component.
// Uses fake timers and recording spies.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tap } from "./gestures";
import { createDispatcher, type DispatcherConfig } from "./dispatcher";
import type {
  ActionId,
  AxisChannelName,
  AxisFrame,
  DualBinding,
  GamepadState,
  LayerName,
  TransientLayerEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const ln = (name: string) => name as LayerName;
const ch = (name: string) => name as AxisChannelName;

type ActionLog = Array<{ kind: string; action?: ActionId; detail?: unknown }>;

function createTestConfig() {
  const log: ActionLog = [];
  let transientLayers: TransientLayerEntry[] = [];

  const config: DispatcherConfig = {
    fireAction: (action) => log.push({ kind: "fire", action }),
    publishAxis: (channel, frame) =>
      log.push({ kind: "axis", detail: { channel, frame } }),
    onLayerPush: (entry) => {
      log.push({ kind: "push", detail: entry });
      transientLayers = [entry, ...transientLayers];
    },
    onLayerPop: (name) => {
      log.push({ kind: "pop", detail: name });
      transientLayers = transientLayers.filter((t) => t.name !== name);
    },
    onNoopFlash: () => log.push({ kind: "noop-flash" }),
    getState: (): GamepadState => ({
      heldButtons: new Set(),
      transientLayers,
      lastInputAt: 0,
      stickPositions: {
        LeftStick: { x: 0, y: 0 },
        RightStick: { x: 0, y: 0 },
      },
    }),
    now: () => Date.now(),
  };

  return { config, log };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

describe("action dispatch", () => {
  it("fires a simple action", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "action",
      action: "eval.now",
      gesture: tap("Start"),
    });

    expect(log).toEqual([{ kind: "fire", action: "eval.now" }]);
    d.dispose();
  });
});

// ---------------------------------------------------------------------------
// Button with only tap binding (no hold/held peer)
// ---------------------------------------------------------------------------

describe("tap-only binding (no hold peer)", () => {
  it("fires immediately regardless of reversibility", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    // Reversible action, no hold peer
    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd" },
      gesture: tap("A"),
    });

    expect(log).toEqual([{ kind: "fire", action: "edit.slurpFwd" }]);

    // Non-reversible action, no hold peer — also fires immediately
    d.dispatch({
      kind: "dual",
      binding: { tap: "picker.select" as unknown as DualBinding["tap"] },
      gesture: tap("B"),
    });

    expect(log).toEqual([
      { kind: "fire", action: "edit.slurpFwd" },
      { kind: "fire", action: "picker.select" },
    ]);

    vi.advanceTimersByTime(500);
    expect(log).toHaveLength(2); // no timers, no undos
    d.dispose();
  });
});

// ---------------------------------------------------------------------------
// Leader dispatch
// ---------------------------------------------------------------------------

describe("leader dispatch", () => {
  it("pushes a transient layer", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "leader",
      layerName: ln("after-Y"),
      gesture: tap("Y"),
    });

    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe("push");
    expect((log[0].detail as TransientLayerEntry).name).toBe(ln("after-Y"));
    d.dispose();
  });
});

// ---------------------------------------------------------------------------
// Axis dispatch
// ---------------------------------------------------------------------------

describe("axis dispatch", () => {
  it("publishes axis frame to channel", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    const frame: AxisFrame = {
      stick: "RightStick",
      x: 0.5,
      y: -0.3,
      t: 100,
    };
    d.dispatch({
      kind: "axis",
      channel: ch("manual-control"),
      stick: "RightStick",
      frame,
    });

    expect(log).toEqual([
      { kind: "axis", detail: { channel: ch("manual-control"), frame } },
    ]);
    d.dispose();
  });
});

// ---------------------------------------------------------------------------
// Miss handling
// ---------------------------------------------------------------------------

describe("miss handling", () => {
  it("pop-and-fall-through pops the top transient layer", () => {
    const { config, log } = createTestConfig();
    // Pre-populate transient layer
    config.onLayerPush({
      name: ln("after-Y"),
      pushedAt: 0,
      expiresAt: 800,
    });
    log.length = 0; // clear push log

    const d = createDispatcher(config);
    d.dispatch({
      kind: "miss",
      gesture: tap("LT"),
      policy: "pop-and-fall-through",
    });

    expect(log).toEqual([{ kind: "pop", detail: ln("after-Y") }]);
    d.dispose();
  });

  it("pop-and-discard pops without further action", () => {
    const { config, log } = createTestConfig();
    config.onLayerPush({
      name: ln("hydra"),
      pushedAt: 0,
      expiresAt: 2000,
    });
    log.length = 0;

    const d = createDispatcher(config);
    d.dispatch({
      kind: "miss",
      gesture: tap("LT"),
      policy: "pop-and-discard",
    });

    expect(log).toEqual([{ kind: "pop", detail: ln("hydra") }]);
    d.dispose();
  });

  it("noop-flash pops and emits flash", () => {
    const { config, log } = createTestConfig();
    config.onLayerPush({
      name: ln("flash"),
      pushedAt: 0,
      expiresAt: null,
    });
    log.length = 0;

    const d = createDispatcher(config);
    d.dispatch({
      kind: "miss",
      gesture: tap("A"),
      policy: "noop-flash",
    });

    expect(log).toEqual([
      { kind: "pop", detail: ln("flash") },
      { kind: "noop-flash" },
    ]);
    d.dispose();
  });
});
