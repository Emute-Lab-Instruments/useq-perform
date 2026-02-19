import type { Meta, StoryObj } from "@storybook/html";
import { NumberInput } from "./FormControls";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Settings/Shared/NumberInput",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.width = "300px";
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <NumberInput {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    value: 42,
    min: 0,
    max: 100,
    step: 1,
    onChange: (val: number) => console.log("Changed:", val),
  },
};

export const Disabled: Story = {
  args: {
    value: 10,
    disabled: true,
    onChange: (val: number) => console.log("Changed:", val),
  },
};
