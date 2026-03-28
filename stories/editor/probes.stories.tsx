import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Probes',
  tags: ['autodocs'],
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const WaveformProbe: Story = {
  args: {
    editorContent: '(sine 440)',
    extensions: ['probes'],
    probes: [{ from: 0, to: 10 }],
  },
};

export const TextModeProbe: Story = {
  args: {
    editorContent: '(> (phase 1) 0.5)',
    extensions: ['probes'],
    probes: [{ from: 0, to: 17 }],
  },
};

export const ProbeOnError: Story = {
  args: {
    editorContent: '(undefined-fn 42)',
    extensions: ['probes'],
    probes: [{ from: 0, to: 17 }],
  },
};

export const MultipleProbes: Story = {
  args: {
    editorContent: '(sine 440)\n(saw 220)\n(tri 110)',
    extensions: ['probes'],
    probes: [
      { from: 0, to: 10 },
      { from: 11, to: 20 },
      { from: 21, to: 30 },
    ],
  },
};

export const ProbeWithTemporalWrapper: Story = {
  args: {
    editorContent: '(slow 4 (sine 110))',
    extensions: ['probes'],
    probes: [{ from: 0, to: 19, mode: 'contextual' }],
  },
};
