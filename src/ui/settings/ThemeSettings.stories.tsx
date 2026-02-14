import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { ThemeSettings } from "./ThemeSettings";

const meta: Meta = {
  title: "UI/Settings/ThemeSettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-window active"; // Mimic legacy container styles
    render(() => <ThemeSettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
