// src/lib/gamepad/storybook.test.ts
//
// Tests for the Storybook gamepad helper. We feed a fake
// `navigator.getGamepads()` (or its injected equivalent) and assert
// that the Solid signals expose the right state.

import { describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

import {
  useGamepadSnapshot,
  useGamepadPipeline,
  onGamepadConnect,
} from "./storybook";
import { createGamepadManager } from "./gamepadManager";

// ---------------------------------------------------------------------------
// Fake gamepad helpers
// ---------------------------------------------------------------------------

interface FakeButton {
  pressed: boolean;
  value: number;
  touched?: boolean;
}

interface FakeGamepadOptions {
  index?: number;
  id?: string;
  connected?: boolean;
  buttons?: FakeButton[];
  axes?: number[];
}

function makeFakeGamepad(opts: FakeGamepadOptions = {}): Gamepad {
  // 16 buttons by default (matches BUTTON_MAP coverage)
  const buttons: FakeButton[] =
    opts.buttons ??
    Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const axes = opts.axes ?? [0, 0, 0, 0];
  return {
    index: opts.index ?? 0,
    id: opts.id ?? "fake-pad",
    connected: opts.connected ?? true,
    timestamp: 0,
    mapping: "standard",
    buttons: buttons as unknown as readonly GamepadButton[],
    axes: axes as readonly number[],
    vibrationActuator: null as unknown as GamepadHapticActuator,
    hapticActuators: [] as readonly GamepadHapticActuator[],
  } as unknown as Gamepad;
}

function makeGetGamepads(
  pads: (Gamepad | null)[],
): () => ArrayLike<Gamepad | null> {
  return () => pads;
}

// ---------------------------------------------------------------------------
// useGamepadSnapshot
// ---------------------------------------------------------------------------

describe("useGamepadSnapshot", () => {
  it("exposes a connected pad's snapshot on next tick", async () => {
    const pad = makeFakeGamepad({ id: "Test Pad", index: 0 });
    let dispose!: () => void;

    const snapAccessor = createRoot((d) => {
      dispose = d;
      return useGamepadSnapshot({
        getGamepads: makeGetGamepads([pad]),
        pollIntervalMs: 5,
      });
    });

    // Immediate tick runs synchronously inside the helper, so a connected
    // pad surfaces without waiting for the interval.
    const first = snapAccessor();
    expect(first).not.toBeNull();
    expect(first?.connected).toBe(true);
    expect(first?.id).toBe("Test Pad");
    expect(first?.index).toBe(0);
    expect(first?.buttons.A).toEqual({ pressed: false, value: 0 });

    dispose();
  });

  it("returns null when no gamepad is connected and does not throw", () => {
    let dispose!: () => void;

    const snapAccessor = createRoot((d) => {
      dispose = d;
      return useGamepadSnapshot({
        getGamepads: makeGetGamepads([null, null, null, null]),
        pollIntervalMs: 5,
      });
    });

    expect(snapAccessor()).toBeNull();

    dispose();
  });

  it("updates the snapshot signal when a button transitions", async () => {
    const buttons: FakeButton[] = Array.from({ length: 16 }, () => ({
      pressed: false,
      value: 0,
    }));
    const pad = makeFakeGamepad({ buttons });
    let dispose!: () => void;

    const snapAccessor = createRoot((d) => {
      dispose = d;
      return useGamepadSnapshot({
        getGamepads: makeGetGamepads([pad]),
        pollIntervalMs: 5,
      });
    });

    expect(snapAccessor()?.buttons.A.pressed).toBe(false);

    // Mutate the underlying fake — the next poll should observe it.
    buttons[0] = { pressed: true, value: 1 };

    await vi.waitFor(() => {
      expect(snapAccessor()?.buttons.A.pressed).toBe(true);
    });

    dispose();
  });
});

// ---------------------------------------------------------------------------
// useGamepadPipeline
// ---------------------------------------------------------------------------

describe("useGamepadPipeline", () => {
  it("emits logical events deterministically when the injected manager sees button presses", async () => {
    // Drive a controllable getGamepads so the test owns the timeline.
    const buttons: FakeButton[] = Array.from({ length: 16 }, () => ({
      pressed: false,
      value: 0,
    }));
    const pad = makeFakeGamepad({ buttons });
    const manager = createGamepadManager({
      getGamepads: makeGetGamepads([pad]),
    });

    let mockTime = 0;
    const now = (): number => mockTime;

    let dispose!: () => void;
    let result!: ReturnType<typeof useGamepadPipeline>;

    createRoot((d) => {
      dispose = d;
      result = useGamepadPipeline({
        gamepadManager: manager,
        pollIntervalMs: 5,
        now,
        // Layers default to modal-shift; that's fine for this assertion
        // because we only check logical/gesture events, not actions.
      });
    });

    // First observer tick captures prevSnapshot (no events yet).
    // Wait briefly for at least one poll to have passed.
    await vi.waitFor(() => {
      // Press A on the fake pad
      buttons[0] = { pressed: true, value: 1 };
      mockTime = 100;
    });

    await vi.waitFor(
      () => {
        const events = result.events();
        const logicalPress = events.find(
          (e) => e.kind === "logical" && e.event.kind === "press",
        );
        expect(logicalPress).toBeDefined();
      },
      { timeout: 1000 },
    );

    // Release A
    buttons[0] = { pressed: false, value: 0 };
    mockTime = 250;

    await vi.waitFor(
      () => {
        const events = result.events();
        const logicalRelease = events.find(
          (e) => e.kind === "logical" && e.event.kind === "release",
        );
        expect(logicalRelease).toBeDefined();
        // A tap gesture should fire after release (within tap window)
        const tap = events.find(
          (e) => e.kind === "gesture" && e.gesture.gesture.kind === "tap",
        );
        expect(tap).toBeDefined();
      },
      { timeout: 1000 },
    );

    result.dispose();
    dispose();
  });

  it("dispose() stops emitting new events", async () => {
    const buttons: FakeButton[] = Array.from({ length: 16 }, () => ({
      pressed: false,
      value: 0,
    }));
    const pad = makeFakeGamepad({ buttons });
    const manager = createGamepadManager({
      getGamepads: makeGetGamepads([pad]),
    });

    let dispose!: () => void;
    let result!: ReturnType<typeof useGamepadPipeline>;

    createRoot((d) => {
      dispose = d;
      result = useGamepadPipeline({
        gamepadManager: manager,
        pollIntervalMs: 5,
      });
    });

    // Capture event count, dispose, then mutate hardware — count should
    // remain stable since the polling intervals are stopped.
    result.dispose();

    const stableCount = result.events().length;

    buttons[0] = { pressed: true, value: 1 };
    await new Promise((r) => setTimeout(r, 30));

    expect(result.events().length).toBe(stableCount);

    dispose();
  });
});

// ---------------------------------------------------------------------------
// onGamepadConnect
// ---------------------------------------------------------------------------

describe("onGamepadConnect", () => {
  it("fires its callback when a `gamepadconnected` event is dispatched", () => {
    const cb = vi.fn();
    const off = onGamepadConnect(cb);

    const fakePad = makeFakeGamepad({
      id: "Connected Pad",
      index: 1,
    });
    // Construct a synthetic event with .gamepad. GamepadEvent constructor
    // exists in modern jsdom; fall back to a plain Event with .gamepad set.
    let event: Event;
    try {
      event = new (window as unknown as {
        GamepadEvent: typeof GamepadEvent;
      }).GamepadEvent("gamepadconnected", {
        gamepad: fakePad,
      });
    } catch {
      event = new Event("gamepadconnected") as Event;
      Object.defineProperty(event, "gamepad", {
        value: fakePad,
        configurable: true,
      });
    }

    window.dispatchEvent(event);

    expect(cb).toHaveBeenCalledTimes(1);
    const snap = cb.mock.calls[0][0];
    expect(snap.connected).toBe(true);
    expect(snap.id).toBe("Connected Pad");
    expect(snap.index).toBe(1);

    off();
  });

  it("disposer removes the listener so further events are ignored", () => {
    const cb = vi.fn();
    const off = onGamepadConnect(cb);
    off();

    const fakePad = makeFakeGamepad({ id: "Pad", index: 0 });
    let event: Event;
    try {
      event = new (window as unknown as {
        GamepadEvent: typeof GamepadEvent;
      }).GamepadEvent("gamepadconnected", { gamepad: fakePad });
    } catch {
      event = new Event("gamepadconnected") as Event;
      Object.defineProperty(event, "gamepad", {
        value: fakePad,
        configurable: true,
      });
    }
    window.dispatchEvent(event);

    expect(cb).not.toHaveBeenCalled();
  });
});
