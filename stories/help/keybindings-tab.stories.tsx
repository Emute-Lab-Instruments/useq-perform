import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { KeybindingsTab } from '@src/ui/help/KeybindingsTab';

const meta: Meta = {
  title: 'Help/Keybindings',
  tags: ['autodocs'],
  component: KeybindingsTab,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
