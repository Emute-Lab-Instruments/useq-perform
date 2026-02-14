import type { Meta, StoryObj } from "@storybook/html";
import { CodeSnippetsTab } from "./CodeSnippetsTab";
import { render } from "solid-js/web";
import { setSnippetStore } from "../../utils/snippetStore";

const mockSnippets = [
  {
    id: 1,
    title: "Basic Beat",
    code: "(play-node :bd (every 4))\n(play-node :sn (every 4 2))",
    tags: ["drums", "basic"],
    createdAt: Date.now() - 10000,
  },
  {
    id: 2,
    title: "Melodic Arp",
    code: "(arpeggiate :osc1 [60 64 67 72] 1/8)",
    tags: ["synth", "arp"],
    createdAt: Date.now() - 5000,
  },
];

const meta: Meta = {
  title: "UI/Help/CodeSnippetsTab",
  render: () => {
    // Reset and mock data
    setSnippetStore({
      snippets: mockSnippets,
      starred: new Set([1]),
      nextId: 3,
    });

    const div = document.createElement("div");
    render(() => <CodeSnippetsTab />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};

export const Empty: Story = {
  render: () => {
    setSnippetStore({
      snippets: [],
      starred: new Set(),
      nextId: 1,
    });
    const div = document.createElement("div");
    render(() => <CodeSnippetsTab />, div);
    return div;
  }
};
