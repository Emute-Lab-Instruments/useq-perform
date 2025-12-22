import type { Meta, StoryObj } from "@storybook/html";
import { Checkbox } from "./shared";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Settings/Shared/Checkbox",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <Checkbox {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Checked: Story = {
  args: {
    checked: true,
    onChange: (val: boolean) => console.log("Changed:", val),
  },
};

export const Unchecked: Story = {
  args: {
    checked: false,
    onChange: (val: boolean) => console.log("Changed:", val),
  },
};
