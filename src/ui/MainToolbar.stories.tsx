import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MainToolbar } from "./MainToolbar";

const meta: Meta<typeof MainToolbar> = {
  title: "UI/MainToolbar",
  component: MainToolbar,
};

export default meta;
type Story = StoryObj<typeof MainToolbar>;

export const Default: Story = {
  render: () => {
    return (
      <div style={{ background: "#1e293b", height: "100vh", padding: "20px" }}>
        <MainToolbar />
      </div>
    );
  }
};
