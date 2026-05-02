import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { InternalVis } from '@src/ui/InternalVis';
import type { SerialBufferSnapshot } from '@src/utils/visualisationStore';

const PALETTE = ['#00ff41', '#1adbdb', '#ffaa00', '#ff0080', '#ff5500', '#ffee33', '#0088ff'];

/**
 * Build a SerialBufferSnapshot — channel 0 is reserved for time, channels 1+
 * are data. The component skips channel 0 when rendering.
 */
function makeSnapshot(): SerialBufferSnapshot {
  const N = 200;
  const time: number[] = new Array(N);
  const ch1: number[] = new Array(N);
  const ch2: number[] = new Array(N);
  const ch3: number[] = new Array(N);
  const ch4: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 4;
    time[i] = i;
    ch1[i] = Math.sin(t);
    ch2[i] = Math.sin(t * 2 + 0.7) * 0.7;
    ch3[i] = Math.sin(t * 0.5 + 1.3) * 0.85;
    ch4[i] = (Math.sin(t * 3 + 2) > 0 ? 1 : -1) * 0.6;
  }
  return {
    channels: [time, ch1, ch2, ch3, ch4],
    lengths: [N, N, N, N, N],
  };
}

function emptySnapshot(): SerialBufferSnapshot {
  return { channels: [], lengths: [] };
}

const meta: Meta = {
  title: 'Visualisation/InternalVis',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

/** Catmull-Rom-interpolated multi-channel plot driven by a sample snapshot. */
export const FourChannels: Story = {
  render: () => (
    <div style={{ width: '720px', height: '320px', background: '#0a0a14', 'border-radius': '4px' }}>
      <InternalVis serialBuffers={makeSnapshot()} palette={PALETTE} />
    </div>
  ),
};

/** Single channel — useful to see the raw waveform and y-axis ticks. */
export const SingleChannel: Story = {
  render: () => {
    const N = 200;
    const time: number[] = new Array(N);
    const ch1: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 4;
      time[i] = i;
      ch1[i] = Math.sin(t) * 0.9;
    }
    const snap: SerialBufferSnapshot = {
      channels: [time, ch1],
      lengths: [N, N],
    };
    return (
      <div style={{ width: '720px', height: '320px', background: '#0a0a14', 'border-radius': '4px' }}>
        <InternalVis serialBuffers={snap} palette={['#00ff41']} />
      </div>
    );
  },
};

/** Empty state — no data renders just the time line and axis. */
export const Empty: Story = {
  render: () => (
    <div style={{ width: '720px', height: '320px', background: '#0a0a14', 'border-radius': '4px' }}>
      <InternalVis serialBuffers={emptySnapshot()} palette={PALETTE} />
    </div>
  ),
};
