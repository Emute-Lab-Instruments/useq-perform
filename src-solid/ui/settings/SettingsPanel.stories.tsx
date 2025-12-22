import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { SettingsPanel } from "./SettingsPanel";

const meta: Meta = {
  title: "UI/Settings/SettingsPanel",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.id = "panel-settings"; // Mimic legacy ID for CSS targeting
    container.style.width = "800px";
    container.style.height = "600px";
    container.style.display = "block";
    render(() => <SettingsPanel />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
