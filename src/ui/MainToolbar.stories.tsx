import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MainToolbar, type MainToolbarProps } from "./MainToolbar";

const noop = () => {};

const defaultProps: MainToolbarProps = {
  connectionState: 'none',
  onConnect: noop,
  onToggleGraph: noop,
  onLoadCode: noop,
  onSaveCode: noop,
  onFontSizeUp: noop,
  onFontSizeDown: noop,
  onSettings: noop,
  onHelp: noop,
};

const meta: Meta<typeof MainToolbar> = {
  title: "UI/MainToolbar",
  component: MainToolbar,
};

export default meta;
type Story = StoryObj<typeof MainToolbar>;

export const Disconnected: Story = {
  render: () => (
    <div style={{ background: "#1e293b", height: "100vh", padding: "20px" }}>
      <MainToolbar {...defaultProps} connectionState="none" />
    </div>
  ),
};

export const Wasm: Story = {
  render: () => (
    <div style={{ background: "#1e293b", height: "100vh", padding: "20px" }}>
      <MainToolbar {...defaultProps} connectionState="wasm" />
    </div>
  ),
};

export const Hardware: Story = {
  render: () => (
    <div style={{ background: "#1e293b", height: "100vh", padding: "20px" }}>
      <MainToolbar {...defaultProps} connectionState="hardware" />
    </div>
  ),
};

export const Both: Story = {
  render: () => (
    <div style={{ background: "#1e293b", height: "100vh", padding: "20px" }}>
      <MainToolbar {...defaultProps} connectionState="both" />
    </div>
  ),
};
