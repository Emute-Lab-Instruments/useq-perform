import type { Meta, StoryObj } from "@storybook/html";
import { ReferenceFilters } from "./ReferenceFilters";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/Subcomponents/ReferenceFilters",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <ReferenceFilters {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    versionOptions: [
      { major: 1, minor: 1, patch: 0, raw: "1.1.0" },
      { major: 1, minor: 0, patch: 0, raw: "1.0.0" },
    ],
    currentTargetVersion: null,
    onVersionChange: (v: string | null) => console.log("Version changed:", v),
    allTags: ["drums", "synth", "utility", "core"],
    selectedTags: new Set(["drums"]),
    onTagToggle: (tag: string) => console.log("Tag toggled:", tag),
    onClearTags: () => console.log("Tags cleared"),
    connectedVersionString: "1.0.0",
  },
};
