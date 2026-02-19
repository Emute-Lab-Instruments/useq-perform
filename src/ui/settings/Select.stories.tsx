import type { Meta, StoryObj } from "@storybook/html";
import { Select } from "./FormControls";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Settings/Shared/Select",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.width = "300px";
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <Select {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    value: "opt1",
    options: [
      { value: "opt1", label: "Option 1" },
      { value: "opt2", label: "Option 2" },
      { value: "opt3", label: "Option 3" },
    ],
    onChange: (val: string) => console.log("Changed:", val),
  },
};
