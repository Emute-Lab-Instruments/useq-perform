import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ReferenceItem } from '@src/ui/help/ReferenceItem';
import type { ReferenceEntry } from '@src/utils/referenceStore';

const sampleEntry: ReferenceEntry = {
  name: 'sine',
  description: 'Sine wave oscillator. Produces a smooth periodic waveform.',
  aliases: ['sin'],
  tags: ['oscillator', 'math'],
  parameters: [
    { name: 'freq', description: 'Frequency in Hz', range: '0.01 - 20000' },
    { name: 'phase', description: 'Initial phase offset (0-1)' },
  ],
  examples: ['(sine 440)', '(a1 (sine 1))'],
  meta: {
    introduced: { raw: '1.0.0', major: 1, minor: 0, patch: 0 },
    changed: null,
  },
};

const unavailableEntry: ReferenceEntry = {
  name: 'spectral-freeze',
  description: 'Freezes the current spectral frame. Requires firmware v2.0.',
  aliases: [],
  tags: ['spectral'],
  parameters: [],
  examples: ['(spectral-freeze)'],
  meta: {
    introduced: { raw: '2.0.0', major: 2, minor: 0, patch: 0 },
    changed: null,
  },
};

const currentVersion = { raw: '1.2.0', major: 1, minor: 2, patch: 0 };

const meta: Meta = {
  title: 'Help/Reference Item',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Available: Story = {
  render: () => <ReferenceItem entry={sampleEntry} targetVersion={currentVersion} />,
};

export const Unavailable: Story = {
  render: () => <ReferenceItem entry={unavailableEntry} targetVersion={currentVersion} />,
};
