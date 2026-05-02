import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  Prose,
  DeepDiveBlock,
  TryItBlock,
  TipBlock,
  ReferenceTableBlock,
  renderContentBlock,
} from '@src/ui/help/guide/contentBlocks';
import type { ContentBlock, ReferenceRow } from '@src/ui/help/guide/guideTypes';

const meta: Meta = {
  title: 'Help/Content Blocks',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const ProseBlock: Story = {
  render: () => (
    <Prose text={
      'The `sine` function produces a smooth periodic waveform. It takes a *frequency* argument in Hz.\n\n' +
      'For example, `(sine 440)` produces a 440 Hz sine wave — concert pitch A4.'
    } />
  ),
};

export const TryIt: Story = {
  render: () => <TryItBlock text="Try changing the frequency: `(sine 220)` vs `(sine 880)`. Notice how the pitch changes." />,
};

export const Tip: Story = {
  render: () => <TipBlock text="Pro tip: use `(sine 0.1)` for a very slow LFO that modulates over 10 seconds." />,
};

export const ReferenceTable: Story = {
  render: () => {
    const rows: ReferenceRow[] = [
      { name: 'sine', signature: '(sine freq)', description: 'Sine wave oscillator' },
      { name: 'saw', signature: '(saw freq)', description: 'Sawtooth wave oscillator' },
      { name: 'tri', signature: '(tri freq)', description: 'Triangle wave oscillator' },
      { name: 'square', signature: '(square freq)', description: 'Square wave oscillator' },
    ];
    return <ReferenceTableBlock rows={rows} />;
  },
};

export const DeepDive: Story = {
  render: () => (
    <DeepDiveBlock
      title="What is a phasor?"
      content={[
        { type: 'prose', text: 'A *phasor* is a signal that ramps linearly from 0 to 1 over one period. It is the foundation of many waveforms.' },
        { type: 'prose', text: 'The `phasor` function takes a frequency: `(phasor 1)` completes one cycle per second.' },
      ]}
    />
  ),
};

export const MixedBlocks: Story = {
  render: () => {
    const blocks: ContentBlock[] = [
      { type: 'prose', text: 'Oscillators are the heart of synthesis. They produce repeating waveforms at a given frequency.' },
      { type: 'tip', text: 'All oscillators accept a frequency argument. Try values below 1 Hz for LFOs.' },
      { type: 'try-it', text: 'Compare: `(sine 1)` vs `(saw 1)`. Listen to the difference in timbre.' },
      {
        type: 'reference-table',
        rows: [
          { name: 'sine', signature: '(sine freq)', description: 'Smooth sine wave' },
          { name: 'saw', signature: '(saw freq)', description: 'Bright sawtooth' },
        ],
      },
      {
        type: 'deep-dive',
        title: 'Harmonic content',
        content: [
          { type: 'prose', text: '`saw` contains all harmonics, while `square` contains only odd harmonics. `sine` is the purest — a single harmonic.' },
        ],
      },
    ];
    return (
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
        {blocks.map((b) => renderContentBlock(b))}
      </div>
    );
  },
};
