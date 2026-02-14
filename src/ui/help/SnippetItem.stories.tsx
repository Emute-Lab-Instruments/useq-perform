import type { Meta, StoryObj } from "@storybook/html";
import { SnippetItem } from "./SnippetItem";
import { render } from "solid-js/web";
import { Snippet } from "../../utils/snippetStore";

const mockSnippet: Snippet = {
  id: 1,
  title: "Example Snippet",
  code: "(every 4 (play-node :bd))",
  tags: ["drums", "test"],
  createdAt: Date.now(),
};

const meta: Meta = {
  title: "UI/Help/Subcomponents/SnippetItem",
  render: (args: any) => {
    const div = document.createElement("div");
    div.style.width = "400px";
    div.style.padding = "20px";
    div.style.background = "#222";
    render(() => <SnippetItem {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    snippet: mockSnippet,
    onEdit: (snippet: Snippet) => console.log("Edit snippet:", snippet),
  },
};
