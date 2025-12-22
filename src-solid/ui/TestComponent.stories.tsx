import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TestComponent } from "./TestComponent";

const meta: Meta<typeof TestComponent> = {
  title: "UI/TestComponent",
  component: TestComponent,
};

export default meta;
type Story = StoryObj<typeof TestComponent>;

export const Default: Story = {};
