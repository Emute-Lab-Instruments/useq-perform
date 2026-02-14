import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { ConfigurationManagement } from "./ConfigurationManagement";

const meta: Meta = {
  title: "UI/Settings/SubComponents/ConfigurationManagement",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    render(() => <ConfigurationManagement />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
