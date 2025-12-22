import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { UISettings } from "./UISettings";

const meta: Meta = {
  title: "UI/Settings/SubComponents/UISettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    render(() => <UISettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
