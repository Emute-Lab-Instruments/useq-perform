import type { Meta, StoryObj } from "@storybook/html";
import { UserGuideContent } from "./UserGuideContent";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/Subcomponents/UserGuideContent",
  render: (args: any) => {
    const div = document.createElement("div");
    render(() => <UserGuideContent {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Loading: Story = {
  args: {
    loading: true,
    content: "",
    error: null,
  },
};

export const WithContent: Story = {
  args: {
    loading: false,
    content: "<h1>Test Guide</h1><p>This is some <strong>HTML</strong> content.</p>",
    error: null,
  },
};

export const Error: Story = {
  args: {
    loading: false,
    content: "",
    error: new Error("Failed to load"),
  },
};
