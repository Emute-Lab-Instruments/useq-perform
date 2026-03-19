// src/lib/gamepadIntents.ts
//
// Gamepad intent emitter. Polls the GamepadManager and publishes
// high-level intents via typed channels. Has ZERO knowledge of menus,
// editors, themes, or settings — it only knows about buttons/axes and
// the intent vocabulary.

import {
  createGamepadManager,
  createEmptyGamepadState,
  cloneSnapshot,
  type GamepadManager,
  type GamepadSnapshot,
  type ButtonState,
} from "./gamepadManager";

import * as ch from "../contracts/gamepadChannels";
import type { ControllerMode } from "../contracts/gamepadChannels";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepeatConfig {
  initialDelay: number;
  repeatInterval: number;
}

interface ButtonRepeatState {
  pressedAt: number;
  lastRepeat: number;
}

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface Scheduler {
  set(callback: () => void, interval: number): ReturnType<typeof setInterval>;
  clear(handle: ReturnType<typeof setInterval>): void;
}

export interface GamepadIntentEmitterOptions {
  gamepadManager?: GamepadManager;
  scheduler?: Scheduler;
  now?: () => number;
  logger?: Logger;
  pollInterval?: number;
  repeatConfig?: Partial<RepeatConfig>;
}

export interface GamepadIntentEmitter {
  start(): void;
  stop(): void;
  dispose(): void;
  /** Exposed for testing — process a single snapshot. */
  processSnapshot(snapshot: GamepadSnapshot | null): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL = 50;
const DEFAULT_REPEAT_CONFIG: RepeatConfig = {
  initialDelay: 300,
  repeatInterval: 60,
};

const MANUAL_CONTROL_AXIS_DEADZONE = 0.12;

const noop = (): void => {};
const nullLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

const defaultScheduler: Scheduler = {
  set(callback: () => void, interval: number) {
    return setInterval(callback, interval);
  },
  clear(handle: ReturnType<typeof setInterval>) {
    clearInterval(handle);
  },
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function cloneGamepadSnapshot(
  snapshot: GamepadSnapshot | null
): GamepadSnapshot {
  const cloned = cloneSnapshot(snapshot);
  if (cloned) return cloned;
  return {
    connected: false,
    id: "",
    index: null,
    timestamp: 0,
    buttons: {},
    axes: {},
  };
}

function isNewPress(
  buttonName: string,
  snapshot: GamepadSnapshot | null,
  prevSnapshot: GamepadSnapshot | null
): boolean {
  const nextPressed = Boolean(snapshot?.buttons?.[buttonName]?.pressed);
  const prevPressed = Boolean(prevSnapshot?.buttons?.[buttonName]?.pressed);
  return nextPressed && !prevPressed;
}

function isButtonPressed(
  buttonName: string,
  snapshot: GamepadSnapshot | null
): boolean {
  return Boolean(snapshot?.buttons?.[buttonName]?.pressed);
}

function pressedButtons(snapshot: GamepadSnapshot | null): string[] {
  return Object.entries(snapshot?.buttons || {})
    .filter(([, value]) => Boolean((value as ButtonState)?.pressed))
    .map(([name]) => name);
}

function computeRepeatState(
  previousState: ButtonRepeatState | undefined,
  now: number,
  config: RepeatConfig
): { shouldTrigger: boolean; state: ButtonRepeatState } {
  if (!previousState) {
    return {
      shouldTrigger: true,
      state: { pressedAt: now, lastRepeat: now },
    };
  }

  const elapsed = now - previousState.pressedAt;
  const sinceLast = now - previousState.lastRepeat;

  if (elapsed >= config.initialDelay && sinceLast >= config.repeatInterval) {
    return {
      shouldTrigger: true,
      state: { pressedAt: previousState.pressedAt, lastRepeat: now },
    };
  }

  return {
    shouldTrigger: false,
    state: previousState,
  };
}

function resolveStickVectors(snapshot: GamepadSnapshot | null): {
  leftStick: { x: number; y: number };
  rightStick: { x: number; y: number };
} {
  const lx = Number(snapshot?.axes?.LeftStickX || 0);
  const ly = Number(snapshot?.axes?.LeftStickY || 0);
  const rx = Number(snapshot?.axes?.RightStickX || 0);
  const ry = Number(snapshot?.axes?.RightStickY || 0);
  return {
    leftStick: { x: lx, y: ly },
    rightStick: { x: rx, y: ry },
  };
}

// ---------------------------------------------------------------------------
// Combo definitions — maps button combos to intent channel publications.
// No knowledge of what the intents actually do.
// ---------------------------------------------------------------------------

interface ComboEntry {
  combo: string[];
  mode: ControllerMode;
  emit: () => void;
}

function buildComboRegistry(): ComboEntry[] {
  return [
    {
      combo: ["LB", "A"],
      mode: "normal",
      emit: () => ch.openMenu.publish({ direction: "before" }),
    },
    {
      combo: ["RB", "A"],
      mode: "normal",
      emit: () => ch.openMenu.publish({ direction: "after" }),
    },
    {
      combo: ["X"],
      mode: "normal",
      emit: () => ch.openRadialMenu.publish({ direction: "replace" }),
    },
    {
      combo: ["Y"],
      mode: "normal",
      emit: () => ch.deleteNode.publish({}),
    },
    {
      combo: ["Start"],
      mode: "normal",
      emit: () => ch.evalNow.publish({}),
    },
    {
      combo: ["Back"],
      mode: "normal",
      emit: () => ch.toggleNavMode.publish({}),
    },
  ];
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

export function createGamepadIntentEmitter(
  options: GamepadIntentEmitterOptions = {}
): GamepadIntentEmitter {
  const gamepadManager =
    options.gamepadManager ?? createGamepadManager({ getGamepads: getMergedGamepads });
  const scheduler = options.scheduler ?? defaultScheduler;
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? nullLogger;
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const repeatConfig: RepeatConfig = {
    initialDelay:
      options.repeatConfig?.initialDelay ?? DEFAULT_REPEAT_CONFIG.initialDelay,
    repeatInterval:
      options.repeatConfig?.repeatInterval ??
      DEFAULT_REPEAT_CONFIG.repeatInterval,
  };

  const comboRegistry = buildComboRegistry();

  let mode: ControllerMode = "normal";
  let buttonRepeat: Record<string, ButtonRepeatState> = {};
  let prevSnapshot: GamepadSnapshot = cloneGamepadSnapshot(
    createEmptyGamepadState({ now })
  );
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let started = false;

  // Subscribe to mode changes from the menu bridge.
  const unsubMode = ch.controllerMode.subscribe((m) => {
    mode = m;
  });

  function tick(): void {
    const snapshot = gamepadManager.poll();
    processSnapshot(snapshot);
  }

  function processSnapshot(snapshot: GamepadSnapshot | null): void {
    const prev = prevSnapshot;

    if (!snapshot?.connected) {
      buttonRepeat = {};
      prevSnapshot = cloneGamepadSnapshot(snapshot);
      return;
    }

    if (mode === "picker" || mode === "number-picker") {
      buttonRepeat = {};
      handlePickerMode(snapshot, prev);
    } else {
      handleNavigation(snapshot, prev);
    }

    if (mode === "normal") {
      handleNumberAdjustment(snapshot, prev);
      handleManualControl(snapshot, prev);
      handleButtonCommands(snapshot, prev);
    }

    prevSnapshot = cloneGamepadSnapshot(snapshot);
  }

  // -- Normal-mode navigation -----------------------------------------------

  const DIRECTIONS = ["Up", "Down", "Left", "Right"] as const;
  const DIRECTION_MAP: Record<string, "up" | "down" | "left" | "right"> = {
    Up: "up",
    Down: "down",
    Left: "left",
    Right: "right",
  };

  function handleNavigation(
    snapshot: GamepadSnapshot,
    prev: GamepadSnapshot
  ): void {
    const nowMs = now();

    for (const button of DIRECTIONS) {
      if (!isButtonPressed(button, snapshot)) {
        if (buttonRepeat[button]) {
          delete buttonRepeat[button];
        }
        continue;
      }

      const repeat = computeRepeatState(
        buttonRepeat[button],
        nowMs,
        repeatConfig
      );
      buttonRepeat[button] = repeat.state;
      if (!repeat.shouldTrigger) continue;

      ch.navigate.publish({
        direction: DIRECTION_MAP[button],
        repeat: !!buttonRepeat[button]?.pressedAt &&
          nowMs - buttonRepeat[button].pressedAt >= repeatConfig.initialDelay,
      });
    }

    if (isNewPress("A", snapshot, prev)) {
      ch.enter.publish({});
    }
    if (isNewPress("B", snapshot, prev)) {
      ch.back.publish({});
    }
  }

  // -- Picker-mode ----------------------------------------------------------

  function handlePickerMode(
    snapshot: GamepadSnapshot,
    prev: GamepadSnapshot
  ): void {
    // Directional navigation
    const directionButtons = ["Left", "Right", "Up", "Down"] as const;
    let direction: "up" | "down" | "left" | "right" | undefined;
    for (const btn of directionButtons) {
      if (isNewPress(btn, snapshot, prev)) {
        direction = DIRECTION_MAP[btn];
        break;
      }
    }

    const sticks = resolveStickVectors(snapshot);
    ch.pickerNavigate.publish({
      direction,
      ...sticks,
    });

    if (isNewPress("A", snapshot, prev)) {
      ch.pickerSelect.publish({});
    } else if (
      isNewPress("B", snapshot, prev) ||
      isNewPress("Back", snapshot, prev)
    ) {
      ch.pickerCancel.publish({});
    }

    // Radial menu apply buttons
    if (isNewPress("RB", snapshot, prev)) {
      ch.pickerApply.publish({ mode: "replace" });
    } else if (isNewPress("RT", snapshot, prev)) {
      ch.pickerApply.publish({ mode: "apply_call" });
    } else if (isNewPress("LB", snapshot, prev)) {
      ch.pickerApply.publish({ mode: "apply_pre" });
    } else if (isNewPress("LT", snapshot, prev)) {
      ch.pickerApply.publish({ mode: "apply" });
    }
  }

  // -- Number adjustment ----------------------------------------------------

  function handleNumberAdjustment(
    snapshot: GamepadSnapshot,
    prev: GamepadSnapshot
  ): void {
    if (isNewPress("LB", snapshot, prev)) {
      ch.adjustNumber.publish({ delta: -1 });
    } else if (isNewPress("RB", snapshot, prev)) {
      ch.adjustNumber.publish({ delta: 1 });
    }
  }

  // -- Manual control -------------------------------------------------------

  function handleManualControl(
    snapshot: GamepadSnapshot,
    prev: GamepadSnapshot
  ): void {
    if (isNewPress("LeftStickPress", snapshot, prev)) {
      ch.toggleManualControl.publish({ stick: "left" });
    }
    if (isNewPress("RightStickPress", snapshot, prev)) {
      ch.toggleManualControl.publish({ stick: "right" });
    }

    // Emit stick axes for both sticks
    for (const stick of ["left", "right"] as const) {
      const axisX = Number(
        snapshot?.axes?.[stick === "right" ? "RightStickX" : "LeftStickX"] || 0
      );
      const axisY = Number(
        snapshot?.axes?.[stick === "right" ? "RightStickY" : "LeftStickY"] || 0
      );
      const x =
        Math.abs(axisX) < MANUAL_CONTROL_AXIS_DEADZONE ? 0 : axisX;
      const y =
        Math.abs(axisY) < MANUAL_CONTROL_AXIS_DEADZONE ? 0 : axisY;

      ch.stickAxis.publish({ stick, x, y });
    }
  }

  // -- Button commands ------------------------------------------------------

  function handleButtonCommands(
    snapshot: GamepadSnapshot,
    prev: GamepadSnapshot
  ): void {
    const pressed = pressedButtons(snapshot);
    if (pressed.length === 0) return;

    for (const command of comboRegistry) {
      if (command.mode && command.mode !== mode) continue;
      if (!isComboTriggered(command.combo, snapshot, prev)) continue;
      command.emit();
    }
  }

  function isComboTriggered(
    combo: string[],
    snapshot: GamepadSnapshot,
    prev: GamepadSnapshot
  ): boolean {
    return (
      combo.every((button) => isButtonPressed(button, snapshot)) &&
      combo.some((button) => isNewPress(button, snapshot, prev))
    );
  }

  // -- Public API -----------------------------------------------------------

  return {
    start(): void {
      if (started) return;
      started = true;
      gamepadManager.connect();
      intervalId = scheduler.set(tick, pollInterval);
      tick();
    },

    stop(): void {
      if (!started) return;
      started = false;
      if (intervalId !== null) {
        scheduler.clear(intervalId);
        intervalId = null;
      }
      gamepadManager.disconnect();
    },

    dispose(): void {
      this.stop();
      gamepadManager.reset();
      unsubMode();
    },

    processSnapshot,
  };
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function getMergedGamepads(): (Gamepad | null)[] {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.getGamepads !== "function"
  ) {
    return [];
  }
  return Array.from(navigator.getGamepads());
}
