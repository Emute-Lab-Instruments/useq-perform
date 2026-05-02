import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { MiniVis } from '@src/ui/help/lessons/MiniVis';
import type { VisSignal } from '@src/ui/help/guide/guideTypes';

const analogSignals: VisSignal[] = [
  { label: 'a1: sine 1Hz', fn: (p) => (Math.sin(p * Math.PI * 2) + 1) / 2, channel: 'a1' },
  { label: 'a2: saw 0.5Hz', fn: (p) => p % 1, channel: 'a2' },
];

const digitalSignals: VisSignal[] = [
  { label: 'a1: sine', fn: (p) => (Math.sin(p * Math.PI * 2) + 1) / 2, channel: 'a1' },
  { label: 'd1: >0.5', fn: (p) => ((Math.sin(p * Math.PI * 2) + 1) / 2) > 0.5 ? 1 : 0, digital: true, channel: 'd1' },
];

const mixedSignals: VisSignal[] = [
  { label: 'a1: sine', fn: (p) => (Math.sin(p * Math.PI * 2) + 1) / 2, channel: 'a1' },
  { label: 'a2: tri', fn: (p) => 1 - Math.abs(((p * 2) % 2) - 1), channel: 'a2' },
  { label: 'd1: gate', fn: (p) => p % 1 > 0.5 ? 1 : 0, digital: true, channel: 'd1' },
  { label: 'd2: trigger', fn: (p) => (p * 4) % 1 < 0.1 ? 1 : 0, digital: true, channel: 'd2' },
];

const meta: Meta = {
  title: 'Help/MiniVis',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const AnalogOnly: Story = {
  render: () => (
    <div style={{ padding: '1rem', width: '400px' }}>
      <MiniVis signals={analogSignals} />
    </div>
  ),
};

export const AnalogAndDigital: Story = {
  render: () => (
    <div style={{ padding: '1rem', width: '400px' }}>
      <MiniVis signals={digitalSignals} />
    </div>
  ),
};

export const MultiChannel: Story = {
  render: () => (
    <div style={{ padding: '1rem', width: '400px' }}>
      <MiniVis signals={mixedSignals} bars={2} height={160} />
    </div>
  ),
};
