import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TransportToolbar, type TransportToolbarProps } from "./TransportToolbar";

const meta: Meta<typeof TransportToolbar> = {
  title: "UI/TransportToolbar",
  component: TransportToolbar,
  argTypes: {
    state: { control: "select", options: ["playing", "paused", "stopped"] },
    mode: { control: "select", options: ["none", "wasm", "hardware", "both"] },
    progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
  },
};

export default meta;
type Story = StoryObj<typeof TransportToolbar>;

const noopCallbacks: Pick<
  TransportToolbarProps,
  "onPlay" | "onPause" | "onStop" | "onRewind" | "onClear"
> = {
  onPlay: () => {},
  onPause: () => {},
  onStop: () => {},
  onRewind: () => {},
  onClear: () => {},
};

export const Playing: Story = {
  render: () => (
    <div style={{ background: "#1e293b", padding: "20px" }}>
      <div style={{ height: "60px" }}>
        <TransportToolbar
          state="playing"
          mode="wasm"
          progress={0.5}
          {...noopCallbacks}
        />
      </div>
    </div>
  ),
};

export const Paused: Story = {
  render: () => (
    <div style={{ background: "#1e293b", padding: "20px" }}>
      <div style={{ height: "60px" }}>
        <TransportToolbar
          state="paused"
          mode="wasm"
          progress={0.3}
          {...noopCallbacks}
        />
      </div>
    </div>
  ),
};

export const Stopped: Story = {
  render: () => (
    <div style={{ background: "#1e293b", padding: "20px" }}>
      <div style={{ height: "60px" }}>
        <TransportToolbar
          state="stopped"
          mode="wasm"
          progress={0}
          {...noopCallbacks}
        />
      </div>
    </div>
  ),
};

export const Disconnected: Story = {
  render: () => (
    <div style={{ background: "#1e293b", padding: "20px" }}>
      <div style={{ height: "60px" }}>
        <TransportToolbar
          state="stopped"
          mode="none"
          progress={0}
          {...noopCallbacks}
        />
      </div>
    </div>
  ),
};
