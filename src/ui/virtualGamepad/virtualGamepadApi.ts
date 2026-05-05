/**
 * Injects a synthetic gamepad into the browser Gamepad API so the existing
 * polling pipeline picks it up transparently. Provides imperative setters
 * for the virtual controller's buttons and axes.
 *
 * Standard Gamepad mapping (Xbox layout):
 *   Buttons: 0=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 6=LT, 7=RT,
 *            8=Back, 9=Start, 10=LSB, 11=RSB, 12=Up, 13=Down, 14=Left, 15=Right
 *   Axes:    0=LeftStickX, 1=LeftStickY, 2=RightStickX, 3=RightStickY
 */

const NUM_BUTTONS = 17;
const NUM_AXES = 4;
const VIRTUAL_GAMEPAD_ID = "Virtual Xbox Controller (Solid.js)";
const VIRTUAL_GAMEPAD_INDEX = 0;

const buttonValues = new Float64Array(NUM_BUTTONS);
const axisValues = new Float64Array(NUM_AXES);

function makeButtonObject(index: number): GamepadButton {
  return {
    get pressed() { return buttonValues[index] > 0.1; },
    get touched() { return buttonValues[index] > 0; },
    get value() { return buttonValues[index]; },
  };
}

const buttons: GamepadButton[] = Array.from({ length: NUM_BUTTONS }, (_, i) => makeButtonObject(i));

const virtualGamepad: Gamepad = {
  get axes() { return Array.from(axisValues); },
  get buttons() { return buttons; },
  connected: true,
  id: VIRTUAL_GAMEPAD_ID,
  index: VIRTUAL_GAMEPAD_INDEX,
  mapping: "standard",
  get timestamp() { return performance.now(); },
  vibrationActuator: null!,
} satisfies Omit<Gamepad, "hapticActuators"> as Gamepad;

let installed = false;
let originalGetGamepads: (() => (Gamepad | null)[]) | null = null;

export function installVirtualGamepad(): void {
  if (installed) return;
  installed = true;

  originalGetGamepads = navigator.getGamepads.bind(navigator);

  navigator.getGamepads = (): (Gamepad | null)[] => {
    const real = originalGetGamepads!();
    const result: (Gamepad | null)[] = Array.from(real);
    // Place virtual gamepad at index 0 if no real gamepad occupies it
    if (!result[VIRTUAL_GAMEPAD_INDEX] || !result[VIRTUAL_GAMEPAD_INDEX]!.connected) {
      result[VIRTUAL_GAMEPAD_INDEX] = virtualGamepad;
    }
    return result;
  };

  // Fire the standard connected event so GamepadManager picks it up
  window.dispatchEvent(
    new GamepadEvent("gamepadconnected", { gamepad: virtualGamepad }),
  );
}

export function uninstallVirtualGamepad(): void {
  if (!installed) return;
  installed = false;

  if (originalGetGamepads) {
    navigator.getGamepads = originalGetGamepads;
    originalGetGamepads = null;
  }

  window.dispatchEvent(
    new GamepadEvent("gamepaddisconnected", { gamepad: virtualGamepad }),
  );
}

// ── Imperative setters for the UI component ──────────────────────

export function setVirtualButton(index: number, value: number): void {
  if (index >= 0 && index < NUM_BUTTONS) {
    buttonValues[index] = value;
  }
}

export function setVirtualAxis(index: number, value: number): void {
  if (index >= 0 && index < NUM_AXES) {
    axisValues[index] = Math.max(-1, Math.min(1, value));
  }
}

export function releaseAllVirtualButtons(): void {
  buttonValues.fill(0);
}

export function resetAllVirtualAxes(): void {
  axisValues.fill(0);
}

// Button index constants for clarity in the component
export const BUTTON = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  Back: 8, Start: 9,
  LeftStickPress: 10, RightStickPress: 11,
  Up: 12, Down: 13, Left: 14, Right: 15,
} as const;

export const AXIS = {
  LeftStickX: 0, LeftStickY: 1,
  RightStickX: 2, RightStickY: 3,
} as const;
