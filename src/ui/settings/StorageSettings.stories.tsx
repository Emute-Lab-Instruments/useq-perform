import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { StorageSettings } from "./StorageSettings";

const meta: Meta = {
  title: "UI/Settings/SubComponents/StorageSettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    render(() => <StorageSettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
