import type { Meta, StoryObj } from "@storybook/html";
import { ReferenceItem } from "./ReferenceItem";
import { render } from "solid-js/web";
import { ReferenceEntry, Version } from "../../utils/referenceStore";

const mockEntry: ReferenceEntry = {
  name: "play-node",
  description: "Plays a node with the given *trigger* pattern.",
  aliases: [],
  tags: ["drums", "core"],
  parameters: [
    { name: "node-id", description: "The ID of the node to play" },
    { name: "pattern", description: "The trigger pattern" },
  ],
  examples: ["(play-node :bd (every 4))"],
  meta: {
    introduced: { major: 1, minor: 0, patch: 0, raw: "1.0.0" },
    changed: null,
  },
};

const meta: Meta = {
  title: "UI/Help/Subcomponents/ReferenceItem",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.padding = "20px";
    div.style.background = "#222"; // Dark background for contrast
    render(() => <ReferenceItem {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Collapsed: Story = {
  args: {
    entry: mockEntry,
    targetVersion: { major: 1, minor: 0, patch: 0, raw: "1.0.0" },
  },
};

export const Unavailable: Story = {
  args: {
    entry: mockEntry,
    targetVersion: { major: 0, minor: 9, patch: 0, raw: "0.9.0" },
  },
};
