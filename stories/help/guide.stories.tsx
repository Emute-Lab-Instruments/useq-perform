import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal, onMount, onCleanup } from 'solid-js';
import { userEvent, within } from 'storybook/test';
import { GuideTab } from '@src/ui/help/guide/GuideTab';
import { GuideSection } from '@src/ui/help/guide/GuideSection';
import { PlaygroundBlock } from '@src/ui/help/guide/Playground';
import { LiveProbe } from '@src/ui/help/guide/LiveProbe';
import type { Section, VisSignal, Playground } from '@src/ui/help/guide/guideTypes';
import { saveRaw } from '@src/lib/persistence';

const DISMISSED_KEY = 'guide-dismissed-sections';

const PHASOR_SIGNAL: VisSignal[] = [
  { label: 'a1', channel: 'a1', fn: (p) => p },
];

const SINE_SIGNALS: VisSignal[] = [
  { label: 'a1', channel: 'a1', fn: (p) => 0.5 + 0.45 * Math.sin(p * Math.PI * 2) },
];

const STATIC_PLAYGROUND: Playground = {
  code: '(a1 (sine 1))',
  annotation: 'A 1Hz sine wave on output a1.',
  signals: SINE_SIGNALS,
};

const RHYTHM_PLAYGROUND: Playground = {
  code: '(d1 (euclid 5 8 bar))',
  annotation: 'Euclidean rhythm — 5 pulses over 8 steps.',
  signals: [
    {
      label: 'd1',
      channel: 'd1',
      digital: true,
      fn: (p) => {
        const idx = Math.floor(p * 8) % 8;
        const pattern = [1, 0, 1, 0, 1, 0, 1, 1];
        return pattern[idx] ?? 0;
      },
    },
  ],
};

const SAMPLE_SECTION: Section = {
  id: 'sine-intro',
  title: 'The Sine Wave',
  summary: 'Smooth periodic signal centred on 0.5.',
  content: [
    { type: 'prose', text: 'A *sine wave* is the simplest periodic signal. Use `sine` to oscillate between 0 and 1.' },
    { type: 'playground', playground: STATIC_PLAYGROUND },
    { type: 'tip', text: 'Try changing the frequency from 1 to 4 to hear an audio-rate oscillator.' },
    { type: 'try-it', text: 'Replace `sine` with `tri` and see how the corners change.' },
    {
      type: 'reference-table',
      rows: [
        { name: 'sine', signature: '(sine freq)', description: 'Sine oscillator (0..1)' },
        { name: 'tri',  signature: '(tri freq)',  description: 'Triangle oscillator (0..1)' },
        { name: 'sqr',  signature: '(sqr freq)',  description: 'Square oscillator (0/1)' },
      ],
    },
  ],
};

const meta: Meta = {
  title: 'Help/Guide',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/**
 * Full GuideTab — renders the real chapter index loaded from `guideData`.
 * Lazy playgrounds are mounted via IntersectionObserver as they scroll
 * into view; the WASM evaluator is not available in Storybook so probes
 * fall back to their static `signals` definitions.
 */
export const FullGuide: Story = {
  render: () => (
    <div class="guide-tab" style={{ height: '720px', width: '100%', overflow: 'auto', background: '#0b1220', padding: '8px' }}>
      <GuideTab />
    </div>
  ),
};

/** A single GuideSection in the collapsed state. */
function ControlledSection(props: { initiallyExpanded: boolean }) {
  const [expanded, setExpanded] = createSignal(props.initiallyExpanded);
  return (
    <div class="guide-tab" style={{ height: '600px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      <GuideSection
        section={SAMPLE_SECTION}
        expanded={expanded()}
        onToggle={() => setExpanded((p) => !p)}
      />
    </div>
  );
}

export const SectionCollapsed: Story = {
  render: () => <ControlledSection initiallyExpanded={false} />,
};

export const SectionExpanded: Story = {
  render: () => <ControlledSection initiallyExpanded={true} />,
};

/** Playground with a static sine signal — drag the body to drop the code into the editor. */
export const PlaygroundSine: Story = {
  render: () => (
    <div class="guide-tab" style={{ width: '720px', background: '#0b1220', padding: '16px' }}>
      <PlaygroundBlock playground={STATIC_PLAYGROUND} />
    </div>
  ),
};

/** Playground with a digital euclidean rhythm. */
export const PlaygroundRhythm: Story = {
  render: () => (
    <div class="guide-tab" style={{ width: '720px', background: '#0b1220', padding: '16px' }}>
      <PlaygroundBlock playground={RHYTHM_PLAYGROUND} />
    </div>
  ),
};

/**
 * LiveProbe with a fallback signal — without a WASM port, the probe shows
 * the fallback waveform and a "loading interpreter…" overlay.
 */
export const LiveProbeFallback: Story = {
  render: () => (
    <div style={{ width: '480px', padding: '16px', background: '#0b1220' }}>
      <LiveProbe code="(a1 (phasor 1))" outputs={['a1']} fallbackSignals={PHASOR_SIGNAL} height={120} />
    </div>
  ),
};

/** LiveProbe with no outputs requested — renders only the static fallback. */
export const LiveProbeStaticOnly: Story = {
  render: () => (
    <div style={{ width: '480px', padding: '16px', background: '#0b1220' }}>
      <LiveProbe code="(a1 (sine 1))" fallbackSignals={SINE_SIGNALS} height={120} />
    </div>
  ),
};

/** LiveProbe with multiple outputs — common real-world case. */
export const LiveProbeMultiOutput: Story = {
  render: () => (
    <div style={{ width: '480px', padding: '16px', background: '#0b1220' }}>
      <LiveProbe
        code="(a1 (sine 1)) (a2 (tri 2)) (d1 (euclid 5 8 bar))"
        outputs={['a1', 'a2', 'd1']}
        fallbackSignals={[
          { label: 'a1', channel: 'a1', fn: (p) => 0.5 + 0.45 * Math.sin(p * Math.PI * 2) },
          { label: 'a2', channel: 'a2', fn: (p) => 0.5 + 0.4 * Math.sin(p * Math.PI * 4 + 0.5) },
          { label: 'd1', channel: 'd1', digital: true, fn: (p) => {
            const idx = Math.floor(p * 8) % 8;
            return ([1, 0, 1, 0, 1, 0, 1, 1])[idx] ?? 0;
          } },
        ]}
        height={140}
      />
    </div>
  ),
};

/** Playground with `outputs` set — engages the LiveProbe path inside Playground. */
export const PlaygroundWithOutputs: Story = {
  render: () => (
    <div class="guide-tab" style={{ width: '720px', background: '#0b1220', padding: '16px' }}>
      <PlaygroundBlock playground={{
        code: '(a1 (sine 1))',
        annotation: 'Live evaluation via LiveProbe — falls back to static signals when WASM is not available.',
        outputs: ['a1'],
        signals: SINE_SIGNALS,
      }} />
    </div>
  ),
};

/**
 * GuideTab with several sections pre-dismissed — exercises the dismissed-row
 * styling at the bottom of the TOC and the "Show all" affordance.
 */
export const GuideWithDismissed: Story = {
  render: () => {
    onMount(() => {
      saveRaw(DISMISSED_KEY, JSON.stringify(['phasor', 'multiplication', 'addition']));
    });
    onCleanup(() => {
      saveRaw(DISMISSED_KEY, JSON.stringify([]));
    });
    return (
      <div class="guide-tab" style={{ height: '720px', width: '100%', overflow: 'auto', background: '#0b1220', padding: '8px' }}>
        <GuideTab />
      </div>
    );
  },
};

/**
 * GuideTab with the TOC programmatically collapsed via play().
 * Demonstrates the collapsed-TOC layout when the user has hidden the contents list.
 */
export const GuideTocCollapsed: Story = {
  render: () => (
    <div class="guide-tab" style={{ height: '720px', width: '100%', overflow: 'auto', background: '#0b1220', padding: '8px' }}>
      <GuideTab />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tocToggle = await canvas.findByRole('button', { name: /Contents/i });
    await userEvent.click(tocToggle);
  },
};

