import { createSignal } from "solid-js";

export type GamepadButton = {
  pressed: boolean;
  value: number;
};

export type VirtualGamepadState = {
  timestamp: number;
  buttons: GamepadButton[];
  axes: number[];
};

const defaultState: VirtualGamepadState = {
  timestamp: 0,
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  axes: [0, 0, 0, 0],
};

const [virtualState, setVirtualState] =
  createSignal<VirtualGamepadState>({ ...defaultState });

export function getVirtualGamepadState(): VirtualGamepadState {
  return virtualState();
}

export function setVirtualGamepadState(
  state: Partial<VirtualGamepadState>,
): void {
  setVirtualState((prev) => ({
    ...prev,
    ...state,
    timestamp: performance.now(),
  }));
}

export function resetVirtualGamepadState(): void {
  setVirtualState({ ...defaultState, timestamp: performance.now() });
}

