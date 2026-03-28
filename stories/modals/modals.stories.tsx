import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Modal } from '@src/ui/Modal';

const meta: Meta<typeof Modal> = {
  title: 'Modals',
  tags: ['autodocs'],
  component: Modal,
};
export default meta;
type Story = StoryObj<typeof Modal>;

export const ConfirmationDialog: Story = {
  render: () => (
    <Modal title="Confirm Action" onClose={() => {}}>
      <p>Are you sure you want to reset all settings?</p>
      <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end">
        <button class="toolbar-button">Cancel</button>
        <button class="toolbar-button primary">Confirm</button>
      </div>
    </Modal>
  ),
  parameters: { docs: { description: { story: 'Modal component with title, message, and action buttons.' } } },
};

export const HtmlContentModal: Story = {
  render: () => (
    <Modal title="Release Notes" onClose={() => {}}>
      <div style={{ "font-size": "0.85rem", "line-height": "1.6" }}>
        <p>
          New in <strong>v1.2.0</strong>:
        </p>
        <ul style={{ "padding-left": "1.25rem", margin: "0.5rem 0" }}>
          <li>
            Improved <em>inline evaluation</em> rendering
          </li>
          <li>
            Added{" "}
            <a href="#" style={{ color: "#7aa2f7", "text-decoration": "underline" }} onClick={(e) => e.preventDefault()}>
              diagnostic hints
            </a>{" "}
            with squiggly underlines
          </li>
          <li>Fixed serialisation edge cases</li>
          <li>
            New <code style={{ background: "rgba(255,255,255,0.08)", padding: "2px 4px", "border-radius": "3px" }}>
              gamepad radial menu
            </code>{" "}
            for expression insertion
          </li>
        </ul>
        <p style={{ "margin-top": "0.75rem" }}>
          See the{" "}
          <a href="#" style={{ color: "#7aa2f7", "text-decoration": "underline" }} onClick={(e) => e.preventDefault()}>
            full changelog
          </a>{" "}
          for details.
        </p>
        <p style={{ "margin-top": "0.5rem", color: "#808098", "font-size": "0.8rem" }}>
          Thank you for using uSEQ Perform.
        </p>
      </div>
    </Modal>
  ),
  parameters: { docs: { description: { story: 'Modal displaying rich HTML content including paragraphs, styled text, lists, and links.' } } },
};
