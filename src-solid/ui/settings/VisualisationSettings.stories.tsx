import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { VisualisationSettings } from "./VisualisationSettings";

const meta: Meta = {
  title: "UI/Settings/SubComponents/VisualisationSettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    render(() => <VisualisationSettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
