import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { GeneralSettings } from "./GeneralSettings";

const meta: Meta = {
  title: "UI/Settings/GeneralSettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-window active"; // Mimic legacy container styles
    render(() => <GeneralSettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
