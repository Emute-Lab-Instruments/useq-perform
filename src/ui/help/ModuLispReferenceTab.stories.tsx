import type { Meta, StoryObj } from "@storybook/html";
import { ModuLispReferenceTab } from "./ModuLispReferenceTab";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/ModuLispReferenceTab",
  render: () => {
    const div = document.createElement("div");
    render(() => <ModuLispReferenceTab />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
