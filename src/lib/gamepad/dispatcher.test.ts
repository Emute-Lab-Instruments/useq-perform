// src/lib/gamepad/dispatcher.test.ts
//
// Tests for the dispatcher — the single impure gamepad component.
// Uses fake timers and recording spies.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tap, hold, held, flick } from "./gestures";
import { createDispatcher, type DispatcherConfig } from "./dispatcher";
import type {
  ActionId,
  AxisChannelName,
  AxisFrame,
  DualBinding,
  GamepadState,
  LayerName,
  Resolution,
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
    undo: () => log.push({ kind: "undo" }),
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
    // Use short holdMs for fast tests
    holdMs: 250,
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
// Dual binding — eager-with-undo (spec §5.2)
// ---------------------------------------------------------------------------

describe("dual binding — eager-with-undo", () => {
  it("fires reversible tap eagerly on press", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });

    expect(log).toEqual([{ kind: "fire", action: "edit.slurpFwd" }]);
    d.dispose();
  });

  it("undoes tap and fires hold after T_hold elapses", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });

    expect(log).toHaveLength(1);
    vi.advanceTimersByTime(250);

    expect(log).toEqual([
      { kind: "fire", action: "edit.slurpFwd" },
      { kind: "undo" },
      { kind: "fire", action: "eval.now" },
    ]);
    d.dispose();
  });

  it("tap stays committed if released before T_hold", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });

    vi.advanceTimersByTime(100); // well before 250ms
    expect(log).toEqual([{ kind: "fire", action: "edit.slurpFwd" }]);

    // Release clears the pending eager tap — timer won't fire after this
    d.notifyRelease("A");
    vi.advanceTimersByTime(200);
    expect(log).toHaveLength(1); // still just the initial tap
    d.dispose();
  });

  it("fires held ticks without undoing tap (spec §5.2.5)", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: { tap: "nav.up", held: "nav.up" },
      gesture: tap("Up"),
    });

    // First held tick — no undo
    d.dispatch({
      kind: "dual",
      binding: { tap: "nav.up", held: "nav.up" },
      gesture: held("Up", 1),
    });

    expect(log).toEqual([
      { kind: "fire", action: "nav.up" },
      { kind: "fire", action: "nav.up" },
    ]);
    expect(log.some((e) => e.kind === "undo")).toBe(false);
    d.dispose();
  });

  it("tap-only dual binding (no hold/held) fires immediately", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd" },
      gesture: tap("A"),
    });

    vi.advanceTimersByTime(500);
    expect(log).toEqual([{ kind: "fire", action: "edit.slurpFwd" }]);
    d.dispose();
  });

  it("recognizer hold gesture triggers undo+hold for eager tap", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    // Tap fires eagerly
    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });

    // Recognizer emits hold before timer fires
    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: hold("A"),
    });

    expect(log).toEqual([
      { kind: "fire", action: "edit.slurpFwd" },
      { kind: "undo" },
      { kind: "fire", action: "eval.now" },
    ]);

    // Timer should be cancelled — no double-fire
    vi.advanceTimersByTime(300);
    expect(log).toHaveLength(3);
    d.dispose();
  });
});

// ---------------------------------------------------------------------------
// Dual binding — deferred tap for non-reversible actions
// ---------------------------------------------------------------------------

describe("dual binding — deferred (non-reversible) tap", () => {
  // Non-reversible tap in a dual binding is a type error at compile time
  // (DualBinding.tap is ReversibleActionId). These tests verify the
  // dispatcher's runtime safety net — if a non-reversible action somehow
  // reaches a dual binding, it defers instead of eagerly firing.
  const nonReversibleBinding: DualBinding = {
    tap: "picker.select" as unknown as DualBinding["tap"],
    hold: "edit.raise",
  };

  it("does NOT fire non-reversible tap eagerly", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });

    // Tap should NOT have fired — deferred
    expect(log).toEqual([]);
    d.dispose();
  });

  it("fires deferred tap on release before T_hold", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });

    expect(log).toEqual([]); // not fired yet

    // Release before hold threshold → fire deferred tap
    d.notifyRelease("A");

    expect(log).toEqual([{ kind: "fire", action: "picker.select" }]);
    d.dispose();
  });

  it("fires hold instead of deferred tap when T_hold elapses", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });

    // Hold timer expires
    vi.advanceTimersByTime(250);

    // Hold fires; tap is discarded (never fired, no undo)
    expect(log).toEqual([{ kind: "fire", action: "edit.raise" }]);
    expect(log.some((e) => e.kind === "undo")).toBe(false);
    d.dispose();
  });

  it("recognizer hold gesture fires hold for deferred tap", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });

    // Recognizer emits hold before timer fires
    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: hold("A"),
    });

    // Hold fires; no undo (tap was never fired)
    expect(log).toEqual([{ kind: "fire", action: "edit.raise" }]);

    // Timer should be cancelled — no double-fire
    vi.advanceTimersByTime(300);
    expect(log).toHaveLength(1);
    d.dispose();
  });

  it("release after T_hold does not fire stale tap", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });

    // Hold timer expires — hold fires
    vi.advanceTimersByTime(250);
    expect(log).toEqual([{ kind: "fire", action: "edit.raise" }]);

    // Late release — no stale tap
    d.notifyRelease("A");
    expect(log).toHaveLength(1);
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
// Multiple rapid taps
// ---------------------------------------------------------------------------

describe("multiple rapid taps", () => {
  it("each eager tap fires and commits independently", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    // First tap — eager, released quickly
    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });
    d.notifyRelease("A"); // release before hold threshold

    expect(log).toEqual([{ kind: "fire", action: "edit.slurpFwd" }]);

    // Second tap — eager again
    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });
    d.notifyRelease("A"); // release before hold threshold

    expect(log).toEqual([
      { kind: "fire", action: "edit.slurpFwd" },
      { kind: "fire", action: "edit.slurpFwd" },
    ]);

    // No stale undos
    vi.advanceTimersByTime(500);
    expect(log.some((e) => e.kind === "undo")).toBe(false);
    d.dispose();
  });

  it("multiple deferred taps fire and commit independently", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);
    const nonReversibleBinding: DualBinding = {
      tap: "picker.select" as unknown as DualBinding["tap"],
      hold: "edit.raise",
    };

    // First tap — deferred, released quickly
    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });
    d.notifyRelease("A");

    expect(log).toEqual([{ kind: "fire", action: "picker.select" }]);

    // Second tap — deferred again
    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });
    d.notifyRelease("A");

    expect(log).toEqual([
      { kind: "fire", action: "picker.select" },
      { kind: "fire", action: "picker.select" },
    ]);
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

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe("dispose", () => {
  it("cancels pending eager-with-undo timers", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);

    d.dispatch({
      kind: "dual",
      binding: { tap: "edit.slurpFwd", hold: "eval.now" },
      gesture: tap("A"),
    });

    d.dispose();
    vi.advanceTimersByTime(500);

    // Only the initial tap should be in the log; hold timer was cancelled
    expect(log).toEqual([{ kind: "fire", action: "edit.slurpFwd" }]);
  });

  it("cancels pending deferred tap timers", () => {
    const { config, log } = createTestConfig();
    const d = createDispatcher(config);
    const nonReversibleBinding: DualBinding = {
      tap: "picker.select" as unknown as DualBinding["tap"],
      hold: "edit.raise",
    };

    d.dispatch({
      kind: "dual",
      binding: nonReversibleBinding,
      gesture: tap("A"),
    });

    d.dispose();
    vi.advanceTimersByTime(500);

    // Nothing should have fired
    expect(log).toEqual([]);
  });
});
