// src/lib/gamepad/hardware.ts
//
// Stage 1 of the gamepad pipeline: hardware adapter.
// Diffs consecutive GamepadSnapshots into LogicalEvent[].
//
// This is the ONLY module allowed to touch browser APIs
// (navigator.getGamepads, performance.now). All other modules
// consume pure LogicalEvent[] streams.
//
// See docs/specs/gamepad.md §2.1, §3.1.

import type { GamepadSnapshot } from "./gamepadManager";
import { BUTTON_MAP } from "./gamepadManager";
import type { ButtonName, LogicalEvent, StickName } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type HardwareConfig = {
  readonly buttonThreshold: number;
};

export const DEFAULT_HARDWARE_CONFIG: HardwareConfig = Object.freeze({
  buttonThreshold: 0.1,
});

// ---------------------------------------------------------------------------
// Button name validation
// ---------------------------------------------------------------------------

const VALID_BUTTONS = new Set<string>(Object.values(BUTTON_MAP));

function isButtonName(name: string): name is ButtonName {
  return VALID_BUTTONS.has(name);
}

// ---------------------------------------------------------------------------
// Stick axis mapping
// ---------------------------------------------------------------------------

type StickAxes = { x: string; y: string };

const STICK_AXES: Record<StickName, StickAxes> = {
  LeftStick: { x: "LeftStickX", y: "LeftStickY" },
  RightStick: { x: "RightStickX", y: "RightStickY" },
};

const STICK_NAMES: StickName[] = ["LeftStick", "RightStick"];

// ---------------------------------------------------------------------------
// Diff: produce LogicalEvent[] from two consecutive snapshots
// ---------------------------------------------------------------------------

export function diffSnapshots(
  prev: GamepadSnapshot,
  curr: GamepadSnapshot,
  t: number,
): LogicalEvent[] {
  const events: LogicalEvent[] = [];

  // Button transitions
  for (const [name, currState] of Object.entries(curr.buttons)) {
    if (!isButtonName(name)) continue;
    const prevState = prev.buttons[name];
    const wasPressing = prevState?.pressed ?? false;
    const isPressing = currState.pressed;

    if (!wasPressing && isPressing) {
      events.push({ kind: "press", btn: name, t });
    } else if (wasPressing && !isPressing) {
      events.push({ kind: "release", btn: name, t });
    }
  }

  // Stick 2D events (combine X/Y axes per stick)
  for (const stick of STICK_NAMES) {
    const { x: xAxis, y: yAxis } = STICK_AXES[stick];
    const prevX = prev.axes[xAxis] ?? 0;
    const prevY = prev.axes[yAxis] ?? 0;
    const currX = curr.axes[xAxis] ?? 0;
    const currY = curr.axes[yAxis] ?? 0;

    if (currX !== prevX || currY !== prevY) {
      events.push({ kind: "axis", stick, x: currX, y: currY, t });
    }
  }

  return events;
}
