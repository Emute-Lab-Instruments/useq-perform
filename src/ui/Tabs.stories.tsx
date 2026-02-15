import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { Tabs } from "./Tabs";

const meta: Meta = {
  title: "UI/Tabs",
  tags: ["autodocs"],
  render: (args) => {
    const container = document.createElement("div");
    container.style.height = "300px";
    container.style.width = "500px";
    container.style.border = "1px solid #ccc";
    render(() => <Tabs {...args} />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    tabs: [
      { id: "tab1", name: "Tab 1", content: () => <div>Content 1</div> },
      { id: "tab2", name: "Tab 2", content: () => <div>Content 2</div> },
      { id: "tab3", name: "Tab 3", content: () => <div>Content 3</div> },
    ],
  },
};
