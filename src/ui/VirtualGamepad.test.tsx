import { describe, it, expect, beforeEach } from "vitest";
import {
  getVirtualGamepadState,
  setVirtualGamepadState,
  resetVirtualGamepadState,
} from "./VirtualGamepad";

describe("VirtualGamepad", () => {
  beforeEach(() => {
    resetVirtualGamepadState();
  });

  describe("default state", () => {
    it("has 17 buttons all unpressed with value 0", () => {
      const state = getVirtualGamepadState();
      expect(state.buttons).toHaveLength(17);
      for (const btn of state.buttons) {
        expect(btn.pressed).toBe(false);
        expect(btn.value).toBe(0);
      }
    });

    it("has 4 axes all set to 0", () => {
      const state = getVirtualGamepadState();
      expect(state.axes).toEqual([0, 0, 0, 0]);
    });
  });

  describe("setVirtualGamepadState", () => {
    it("updates axes with partial state", () => {
      setVirtualGamepadState({ axes: [0.5, -0.5, 1, -1] });
      const state = getVirtualGamepadState();
      expect(state.axes).toEqual([0.5, -0.5, 1, -1]);
    });

    it("updates buttons with partial state", () => {
      const newButtons = Array.from({ length: 17 }, (_, i) => ({
        pressed: i === 0,
        value: i === 0 ? 1 : 0,
      }));
      setVirtualGamepadState({ buttons: newButtons });
      const state = getVirtualGamepadState();
      expect(state.buttons[0].pressed).toBe(true);
      expect(state.buttons[0].value).toBe(1);
      expect(state.buttons[1].pressed).toBe(false);
    });

    it("updates timestamp on every set call", () => {
      const before = getVirtualGamepadState().timestamp;
      setVirtualGamepadState({ axes: [1, 0, 0, 0] });
      const after = getVirtualGamepadState().timestamp;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it("preserves unmodified fields", () => {
      setVirtualGamepadState({ axes: [0.25, 0.5, 0.75, 1.0] });
      setVirtualGamepadState({});
      const state = getVirtualGamepadState();
      // axes should still be what we set
      expect(state.axes).toEqual([0.25, 0.5, 0.75, 1.0]);
    });
  });

  describe("resetVirtualGamepadState", () => {
    it("resets axes to all zeros", () => {
      setVirtualGamepadState({ axes: [1, 1, 1, 1] });
      resetVirtualGamepadState();
      const state = getVirtualGamepadState();
      expect(state.axes).toEqual([0, 0, 0, 0]);
    });

    it("resets all buttons to unpressed", () => {
      const pressed = Array.from({ length: 17 }, () => ({
        pressed: true,
        value: 1,
      }));
      setVirtualGamepadState({ buttons: pressed });
      resetVirtualGamepadState();
      const state = getVirtualGamepadState();
      for (const btn of state.buttons) {
        expect(btn.pressed).toBe(false);
        expect(btn.value).toBe(0);
      }
    });

    it("updates timestamp on reset", () => {
      const before = getVirtualGamepadState().timestamp;
      resetVirtualGamepadState();
      const after = getVirtualGamepadState().timestamp;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

});
