import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { EditorSettings } from "./EditorSettings";

const meta: Meta = {
  title: "UI/Settings/SubComponents/EditorSettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    render(() => <EditorSettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
