import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Probes',
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const WaveformProbe: Story = {
  args: {
    editorContent: '(sine 440) ;probe',
    extensions: ['probes'],
  },
};

export const TextModeProbe: Story = {
  args: {
    editorContent: '(> (phase 1) 0.5) ;probe',
    extensions: ['probes'],
  },
};

export const ProbeOnError: Story = {
  args: {
    editorContent: '(undefined-fn 42) ;probe',
    extensions: ['probes'],
  },
};

export const MultipleProbes: Story = {
  args: {
    editorContent: '(sine 440) ;probe\n(saw 220) ;probe\n(tri 110) ;probe',
    extensions: ['probes'],
  },
};

export const ProbeWithTemporalWrapper: Story = {
  args: {
    editorContent: '(slow 4 (sine 110)) ;probe',
    extensions: ['probes'],
  },
};
