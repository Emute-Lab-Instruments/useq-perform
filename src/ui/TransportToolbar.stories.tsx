import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TransportToolbar } from "./TransportToolbar";

const meta: Meta<typeof TransportToolbar> = {
  title: "UI/TransportToolbar",
  component: TransportToolbar,
};

export default meta;
type Story = StoryObj<typeof TransportToolbar>;

export const Default: Story = {
  render: () => {
    return (
      <div style={{ background: "#1e293b", padding: "20px" }}>
        <div style={{ height: "60px" }}>
          <TransportToolbar />
        </div>
      </div>
    );
  }
};
