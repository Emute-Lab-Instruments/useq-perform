import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  getVirtualGamepadState,
  setVirtualGamepadState,
  resetVirtualGamepadState,
} from "./VirtualGamepad";

const VirtualGamepadDemo = () => {
  const state = () => getVirtualGamepadState();

  return (
    <div style={{ padding: "16px", "font-family": "monospace" }}>
      <h3>Virtual Gamepad State</h3>
      <div style={{ "margin-bottom": "12px" }}>
        <button onClick={() => setVirtualGamepadState({ axes: [1, 0, 0, 0] })}>
          Left Stick Right
        </button>{" "}
        <button onClick={() => setVirtualGamepadState({ axes: [0, 0, 1, 0] })}>
          Right Stick Right
        </button>{" "}
        <button onClick={resetVirtualGamepadState}>Reset</button>
      </div>
      <pre>{JSON.stringify(state(), null, 2)}</pre>
    </div>
  );
};

const meta: Meta = {
  title: "UI/VirtualGamepad",
  component: VirtualGamepadDemo,
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
