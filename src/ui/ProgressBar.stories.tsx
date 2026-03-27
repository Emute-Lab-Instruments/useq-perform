import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ProgressBar } from "./ProgressBar";

const meta: Meta<typeof ProgressBar> = {
  title: "UI/ProgressBar",
  component: ProgressBar,
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "400px", background: "#1e293b", padding: "20px" }}>
      <div class="toolbar-row" style={{ width: "100%", height: "40px" }} />
      <ProgressBar progress={0.5} />
    </div>
  ),
};

export const Full: Story = {
  render: () => (
    <div style={{ width: "400px", background: "#1e293b", padding: "20px" }}>
      <div class="toolbar-row" style={{ width: "100%", height: "40px" }} />
      <ProgressBar progress={1.0} />
    </div>
  ),
};
