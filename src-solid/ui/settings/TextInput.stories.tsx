import type { Meta, StoryObj } from "@storybook/html";
import { TextInput } from "./shared";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Settings/Shared/TextInput",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.width = "300px";
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <TextInput {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    value: "Example text",
    placeholder: "Type something...",
    onChange: (val: string) => console.log("Changed:", val),
  },
};

export const Empty: Story = {
  args: {
    value: "",
    placeholder: "Empty state",
    onChange: (val: string) => console.log("Changed:", val),
  },
};
