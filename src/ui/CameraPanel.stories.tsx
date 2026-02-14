import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CameraPanel } from "./CameraPanel";

const meta: Meta<typeof CameraPanel> = {
  title: "UI/CameraPanel",
  component: CameraPanel,
};

export default meta;
type Story = StoryObj<typeof CameraPanel>;

export const Default: Story = {
  args: {
    width: 640,
    height: 480,
  },
};
