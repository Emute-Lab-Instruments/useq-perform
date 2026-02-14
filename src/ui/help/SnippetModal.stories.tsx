import type { Meta, StoryObj } from "@storybook/html";
import { SnippetModal } from "./SnippetModal";
import { render } from "solid-js/web";
import { Snippet } from "../../utils/snippetStore";

const mockSnippet: Snippet = {
  id: 1,
  title: "Existing Snippet",
  code: "(arpeggiate :osc1 [60 64 67])",
  tags: ["synth", "arp"],
  createdAt: Date.now(),
};

const meta: Meta = {
  title: "UI/Help/Subcomponents/SnippetModal",
  render: (args: any) => {
    const div = document.createElement("div");
    // Modal needs a container, usually it's absolute positioned
    div.style.height = "600px";
    render(() => <SnippetModal {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const AddNew: Story = {
  args: {
    editingSnippet: "new",
    onClose: () => console.log("Modal closed"),
  },
};

export const EditExisting: Story = {
  args: {
    editingSnippet: mockSnippet,
    onClose: () => console.log("Modal closed"),
  },
};
