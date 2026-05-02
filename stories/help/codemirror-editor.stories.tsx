import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { CodeMirrorEditor } from '@src/ui/help/CodeMirrorEditor';

const meta: Meta = {
  title: 'Help/CodeMirror Editor',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const ReadOnly: Story = {
  render: () => (
    <div style={{ padding: '1rem', width: '400px' }}>
      <CodeMirrorEditor
        code="(a1 (sine 440))"
        readOnly={true}
        fontSize="13px"
        minHeight="40px"
      />
    </div>
  ),
};

export const Lightweight: Story = {
  render: () => (
    <div style={{ padding: '1rem', width: '400px' }}>
      <CodeMirrorEditor
        code=";; Try editing this!\n(a1 (sine 0.5))"
        lightweight={true}
        fontSize="13px"
      />
    </div>
  ),
};

export const FullFeatured: Story = {
  render: () => (
    <div style={{ padding: '1rem', width: '400px' }}>
      <CodeMirrorEditor
        code=";; Full editor with eval + probes\n(a1 (sine 1))\n(d1 (euclid 3 8))"
        fontSize="13px"
      />
    </div>
  ),
};
