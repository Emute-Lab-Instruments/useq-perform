import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { PersonalSettings } from "./PersonalSettings";

const meta: Meta = {
  title: "UI/Settings/SubComponents/PersonalSettings",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    render(() => <PersonalSettings />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
