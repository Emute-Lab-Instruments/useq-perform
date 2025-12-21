/**
 * Virtual Gamepad State
 * Provides a mock gamepad interface for testing/development without physical hardware.
 */

const defaultState = {
  timestamp: 0,
  buttons: Array(17).fill(null).map(() => ({ pressed: false, value: 0 })),
  axes: [0, 0, 0, 0]
};

let virtualState = { ...defaultState };

export function getVirtualGamepadState() {
  return virtualState;
}

export function setVirtualGamepadState(state) {
  virtualState = {
    ...virtualState,
    ...state,
    timestamp: performance.now()
  };
}

export function resetVirtualGamepadState() {
  virtualState = { ...defaultState, timestamp: performance.now() };
}
