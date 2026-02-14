import type { Meta, StoryObj } from "@storybook/html";
import { UserGuideTab } from "./UserGuideTab";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/UserGuideTab",
  render: () => {
    const div = document.createElement("div");
    render(() => <UserGuideTab />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
