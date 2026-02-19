import type { Meta, StoryObj } from "@storybook/html";
import { RangeInput } from "./FormControls";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Settings/Shared/RangeInput",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.width = "300px";
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <RangeInput {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    value: 5,
    min: 0,
    max: 10,
    step: 0.1,
    formatValue: (v: number) => `${v.toFixed(1)}%`,
    onChange: (val: number) => console.log("Changed:", val),
  },
};

export const Disabled: Story = {
  args: {
    value: 3,
    min: 0,
    max: 10,
    step: 1,
    disabled: true,
    onChange: (val: number) => console.log("Changed:", val),
  },
};
