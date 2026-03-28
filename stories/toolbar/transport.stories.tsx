import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { TransportToolbar } from '@src/ui/TransportToolbar';

const noop = () => {};

const meta: Meta<typeof TransportToolbar> = {
  title: 'Toolbar/Transport',
  component: TransportToolbar,
  decorators: [
    (Story) => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    mode: 'hardware',
    progress: 0.5,
    onPlay: noop,
    onPause: noop,
    onStop: noop,
    onRewind: noop,
    onClear: noop,
  },
};
export default meta;
type Story = StoryObj<typeof TransportToolbar>;

export const Playing: Story = { args: { state: 'playing' } };
export const Paused: Story = { args: { state: 'paused' } };
export const Stopped: Story = { args: { state: 'stopped' } };
