// src/lib/gamepad/hardware.test.ts
//
// Tests for Stage 1 hardware adapter. These are pure function tests —
// no navigator, no DOM. Feed synthetic GamepadSnapshots, assert
// LogicalEvent[] output.

import { describe, expect, it } from "vitest";
import type { GamepadSnapshot } from "../gamepadManager";
import { diffSnapshots } from "./hardware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSnapshot(
  overrides: Partial<GamepadSnapshot> = {},
): GamepadSnapshot {
  return {
    connected: true,
    id: "test",
    index: 0,
    timestamp: 0,
    buttons: {
      A: { pressed: false, value: 0 },
      B: { pressed: false, value: 0 },
      X: { pressed: false, value: 0 },
      Y: { pressed: false, value: 0 },
      LB: { pressed: false, value: 0 },
      RB: { pressed: false, value: 0 },
      LT: { pressed: false, value: 0 },
      RT: { pressed: false, value: 0 },
      Up: { pressed: false, value: 0 },
      Down: { pressed: false, value: 0 },
      Left: { pressed: false, value: 0 },
      Right: { pressed: false, value: 0 },
      Start: { pressed: false, value: 0 },
      Back: { pressed: false, value: 0 },
      LeftStickPress: { pressed: false, value: 0 },
      RightStickPress: { pressed: false, value: 0 },
    },
    axes: {
      LeftStickX: 0,
      LeftStickY: 0,
      RightStickX: 0,
      RightStickY: 0,
    },
    ...overrides,
  };
}

function withButton(
  snap: GamepadSnapshot,
  btn: string,
  pressed: boolean,
  value = pressed ? 1 : 0,
): GamepadSnapshot {
  return {
    ...snap,
    buttons: {
      ...snap.buttons,
      [btn]: { pressed, value },
    },
  };
}

function withAxis(
  snap: GamepadSnapshot,
  axis: string,
  value: number,
): GamepadSnapshot {
  return {
    ...snap,
    axes: { ...snap.axes, [axis]: value },
  };
}

// ---------------------------------------------------------------------------
// Button transitions
// ---------------------------------------------------------------------------

describe("diffSnapshots — buttons", () => {
  it("emits press when button transitions from unpressed to pressed", () => {
    const prev = mkSnapshot();
    const curr = withButton(prev, "A", true);
    const events = diffSnapshots(prev, curr, 100);
    expect(events).toContainEqual({ kind: "press", btn: "A", t: 100 });
  });

  it("emits release when button transitions from pressed to unpressed", () => {
    const prev = withButton(mkSnapshot(), "A", true);
    const curr = withButton(prev, "A", false);
    const events = diffSnapshots(prev, curr, 200);
    expect(events).toContainEqual({ kind: "release", btn: "A", t: 200 });
  });

  it("emits nothing when button state is unchanged", () => {
    const snap = mkSnapshot();
    expect(diffSnapshots(snap, snap, 0)).toEqual([]);
  });

  it("emits multiple transitions for different buttons", () => {
    const prev = withButton(mkSnapshot(), "A", true);
    let curr = withButton(prev, "A", false); // release A
    curr = withButton(curr, "B", true); // press B
    const events = diffSnapshots(prev, curr, 50);
    expect(events).toContainEqual({ kind: "release", btn: "A", t: 50 });
    expect(events).toContainEqual({ kind: "press", btn: "B", t: 50 });
  });

  it("handles all 16 standard buttons", () => {
    const prev = mkSnapshot();
    let curr = prev;
    const buttons = [
      "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
      "Up", "Down", "Left", "Right", "Start", "Back",
      "LeftStickPress", "RightStickPress",
    ];
    for (const btn of buttons) {
      curr = withButton(curr, btn, true);
    }
    const events = diffSnapshots(prev, curr, 0);
    expect(events.filter((e) => e.kind === "press")).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// Axis events (2D stick)
// ---------------------------------------------------------------------------

describe("diffSnapshots — axes", () => {
  it("emits axis event when left stick X changes", () => {
    const prev = mkSnapshot();
    const curr = withAxis(prev, "LeftStickX", 0.5);
    const events = diffSnapshots(prev, curr, 100);
    expect(events).toContainEqual({
      kind: "axis",
      stick: "LeftStick",
      x: 0.5,
      y: 0,
      t: 100,
    });
  });

  it("emits axis event when left stick Y changes", () => {
    const prev = mkSnapshot();
    const curr = withAxis(prev, "LeftStickY", -0.8);
    const events = diffSnapshots(prev, curr, 100);
    expect(events).toContainEqual({
      kind: "axis",
      stick: "LeftStick",
      x: 0,
      y: -0.8,
      t: 100,
    });
  });

  it("combines X and Y changes into one 2D event", () => {
    const prev = mkSnapshot();
    let curr = withAxis(prev, "RightStickX", 0.3);
    curr = withAxis(curr, "RightStickY", -0.7);
    const events = diffSnapshots(prev, curr, 50);
    const axisEvents = events.filter(
      (e) => e.kind === "axis" && e.stick === "RightStick",
    );
    expect(axisEvents).toHaveLength(1);
    expect(axisEvents[0]).toEqual({
      kind: "axis",
      stick: "RightStick",
      x: 0.3,
      y: -0.7,
      t: 50,
    });
  });

  it("emits nothing when axes are unchanged", () => {
    const snap = mkSnapshot();
    const events = diffSnapshots(snap, snap, 0);
    expect(events.filter((e) => e.kind === "axis")).toHaveLength(0);
  });

  it("emits separate events for left and right stick", () => {
    const prev = mkSnapshot();
    let curr = withAxis(prev, "LeftStickX", 0.5);
    curr = withAxis(curr, "RightStickY", -0.9);
    const events = diffSnapshots(prev, curr, 100);
    const left = events.filter(
      (e) => e.kind === "axis" && e.stick === "LeftStick",
    );
    const right = events.filter(
      (e) => e.kind === "axis" && e.stick === "RightStick",
    );
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mixed
// ---------------------------------------------------------------------------

describe("diffSnapshots — mixed", () => {
  it("emits button presses and axis events from the same diff", () => {
    const prev = mkSnapshot();
    let curr = withButton(prev, "A", true);
    curr = withAxis(curr, "LeftStickX", 0.8);
    const events = diffSnapshots(prev, curr, 100);
    expect(events.some((e) => e.kind === "press")).toBe(true);
    expect(events.some((e) => e.kind === "axis")).toBe(true);
  });

  it("button events come before axis events", () => {
    const prev = mkSnapshot();
    let curr = withButton(prev, "A", true);
    curr = withAxis(curr, "LeftStickX", 0.8);
    const events = diffSnapshots(prev, curr, 100);
    const pressIdx = events.findIndex((e) => e.kind === "press");
    const axisIdx = events.findIndex((e) => e.kind === "axis");
    expect(pressIdx).toBeLessThan(axisIdx);
  });
});
