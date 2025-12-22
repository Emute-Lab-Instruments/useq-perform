import type { Meta, StoryObj } from "@storybook/html";
import { KeybindingsTab } from "./KeybindingsTab";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/KeybindingsTab",
  render: () => {
    const div = document.createElement("div");
    div.style.width = "400px";
    div.classList.add("help-panel"); // Assuming help-panel class provides some styling
    render(() => <KeybindingsTab />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
