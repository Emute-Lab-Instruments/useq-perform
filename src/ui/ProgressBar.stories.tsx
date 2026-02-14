import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ProgressBar } from "./ProgressBar";

const meta: Meta<typeof ProgressBar> = {
  title: "UI/ProgressBar",
  component: ProgressBar,
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Default: Story = {
  render: () => {
    // Helper to simulate progress
    setTimeout(() => {
      const event = new CustomEvent("useq-visualisation-changed", {
        detail: { bar: 0.5 }
      });
      window.dispatchEvent(event);
    }, 500);

    return (
      <div style={{ width: "400px", background: "#1e293b", padding: "20px" }}>
        <div class="toolbar-row" style={{ width: "100%", height: "40px" }}>
           {/* Progress bar syncs with .toolbar-row width */}
        </div>
        <ProgressBar />
      </div>
    );
  }
};

export const Full: Story = {
  render: () => {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("useq-visualisation-changed", {
        detail: { bar: 1.0 }
      }));
    }, 100);

    return (
      <div style={{ width: "400px", background: "#1e293b", padding: "20px" }}>
        <div class="toolbar-row" style={{ width: "100%", height: "40px" }}></div>
        <ProgressBar />
      </div>
    );
  }
};
