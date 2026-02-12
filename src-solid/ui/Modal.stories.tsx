import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Modal, HtmlModal } from "./Modal";

const meta: Meta<typeof Modal> = {
  title: "UI/Modal",
  component: Modal,
};

export default meta;
type Story = StoryObj<typeof Modal>;

export const Default: Story = {
  args: {
    id: "demo-modal",
    title: "Example Modal",
    onClose: () => console.log("Close"),
    children: (
      <div>
        <p>This is a reusable modal component ported from the legacy jQuery system.</p>
        <p>It supports Escape key, overlay click to close, and theme inheritance.</p>
      </div>
    ),
  },
};

export const HtmlContent: StoryObj<typeof HtmlModal> = {
  render: () => (
    <HtmlModal
      id="html-modal"
      title="Browser Not Supported"
      content="<p>This browser doesn't support the WebSerial API.</p><p>Please try using a Chrome or Chromium-based browser.</p>"
      onClose={() => console.log("Close")}
    />
  ),
};
