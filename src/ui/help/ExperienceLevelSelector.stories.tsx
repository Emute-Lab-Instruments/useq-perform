import type { Meta, StoryObj } from "@storybook/html";
import { ExperienceLevelSelector } from "./ExperienceLevelSelector";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/Subcomponents/ExperienceLevelSelector",
  render: (args: any) => {
    const div = document.createElement("div");
    render(() => <ExperienceLevelSelector {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Beginner: Story = {
  args: {
    level: "beginner",
    onLevelChange: (level: string) => console.log("Level changed to:", level),
  },
};

export const Advanced: Story = {
  args: {
    level: "advanced",
    onLevelChange: (level: string) => console.log("Level changed to:", level),
  },
};
