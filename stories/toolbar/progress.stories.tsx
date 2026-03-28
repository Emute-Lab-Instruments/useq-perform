import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ProgressBar } from '@src/ui/ProgressBar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Toolbar/Progress Bar',
  component: ProgressBar,
  decorators: [
    (Story) => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <div class="toolbar-row" style={{ width: '100%', height: '40px' }} />
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const SixtyPercent: Story = {
  args: { progress: 0.6 },
  parameters: { docs: { description: { story: 'ProgressBar at 60% fill. The bar visually fills about 3/5 of the container width via scaleX transform.' } } },
};
