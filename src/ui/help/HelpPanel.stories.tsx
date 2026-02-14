import type { Meta, StoryObj } from "@storybook/html";
import { HelpPanel } from "./HelpPanel";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/HelpPanel",
  render: (args) => {
    const div = document.createElement("div");
    div.style.height = "500px";
    div.style.width = "800px";
    div.style.border = "1px solid #ccc";
    render(() => <HelpPanel />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
