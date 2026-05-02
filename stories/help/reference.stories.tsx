import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup } from 'solid-js';
import { ModuLispReferenceTab } from '@src/ui/help/ModuLispReferenceTab';
import { ReferencePanel } from '@src/ui/help/ReferencePanel';
import {
  setReferenceStore,
  type ReferenceEntry,
} from '@src/utils/referenceStore';

const v = (raw: string) => {
  const [maj, min = '0', pat = '0'] = raw.split('.');
  return { major: +maj, minor: +min, patch: +pat, raw };
};

const SAMPLE_ENTRIES: ReferenceEntry[] = [
  {
    name: 'sine',
    description: 'Sine wave oscillator. Returns a unipolar signal in 0..1.',
    aliases: ['sin'],
    tags: ['Math', 'Signals'],
    parameters: [
      { name: 'freq', description: 'Frequency in Hz', range: '0..20000' },
    ],
    examples: ['(a1 (sine 0.5))', '(a2 (sine bar))'],
    meta: { introduced: v('1.0.0'), changed: null },
  },
  {
    name: 'sqr',
    description: 'Square wave oscillator producing a 50% duty cycle.',
    aliases: [],
    tags: ['Math', 'Signals'],
    parameters: [
      { name: 'freq', description: 'Frequency in Hz' },
    ],
    examples: ['(d1 (sqr 4))'],
    meta: { introduced: v('1.0.0'), changed: null },
  },
  {
    name: 'euclid',
    description: 'Euclidean rhythm — distributes pulses evenly across steps.',
    aliases: [],
    tags: ['Sequencing', 'Logic'],
    parameters: [
      { name: 'pulses', description: 'Number of active steps' },
      { name: 'steps',  description: 'Total step count' },
      { name: 'phase',  description: 'Time-base (e.g. bar)' },
    ],
    examples: ['(d1 (euclid 5 8 bar))'],
    meta: { introduced: v('1.1.0'), changed: v('1.2.0') },
  },
  {
    name: 'fast',
    description: 'Speed up a time-base by a factor.',
    aliases: [],
    tags: ['Timing'],
    parameters: [
      { name: 'factor', description: 'Multiplier' },
      { name: 'phase', description: 'Time-base to scale' },
    ],
    examples: ['(fast 8 bar)'],
    meta: { introduced: v('1.0.0'), changed: null },
  },
  {
    name: 'slow',
    description: 'Slow down a time-base by a factor.',
    aliases: [],
    tags: ['Timing'],
    parameters: [
      { name: 'factor', description: 'Divisor' },
      { name: 'phase', description: 'Time-base to scale' },
    ],
    examples: ['(slow 4 bar)'],
    meta: { introduced: v('1.0.0'), changed: null },
  },
  {
    name: 'tri',
    description: 'Triangle oscillator. Linear ramp up and down.',
    aliases: [],
    tags: ['Math', 'Signals'],
    parameters: [{ name: 'freq', description: 'Frequency in Hz' }],
    examples: ['(a3 (tri 1))'],
    meta: { introduced: v('1.0.0'), changed: null },
  },
];

function ReferenceHarness(props: { children: () => any }) {
  onMount(() => {
    setReferenceStore('data', SAMPLE_ENTRIES);
    setReferenceStore('isLoading', false);
    setReferenceStore('error', null);
    setReferenceStore('targetVersion', null);
  });
  onCleanup(() => {
    setReferenceStore('data', []);
    setReferenceStore('isLoading', true);
  });
  return (
    <div style={{ width: '100%', 'max-width': '720px', height: '640px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      {props.children()}
    </div>
  );
}

const meta: Meta = {
  title: 'Help/Reference',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/** ModuLisp reference tab populated with seed entries — exercise filters & expansion. */
export const ReferenceTab: Story = {
  render: () => <ReferenceHarness>{() => <ModuLispReferenceTab />}</ReferenceHarness>,
};

/** Reference panel: tabbed wrapper around ModuLisp reference + Editor keybindings tab. */
export const Panel: Story = {
  render: () => <ReferenceHarness>{() => <ReferencePanel />}</ReferenceHarness>,
};

/** Loading state — `isLoading=true` displays the loading message. */
export const Loading: Story = {
  render: () => {
    onMount(() => {
      setReferenceStore('data', []);
      setReferenceStore('isLoading', true);
    });
    onCleanup(() => {
      setReferenceStore('isLoading', false);
    });
    return (
      <div style={{ width: '100%', 'max-width': '720px', height: '640px', background: '#0b1220', padding: '12px' }}>
        <ModuLispReferenceTab />
      </div>
    );
  },
};

/**
 * Reference tab with two entries pre-expanded — exposes the full body
 * (parameters, examples, version metadata) inline.
 */
export const ExpandedEntries: Story = {
  render: () => {
    onMount(() => {
      setReferenceStore('data', SAMPLE_ENTRIES);
      setReferenceStore('isLoading', false);
      setReferenceStore('expanded', new Set(['sine', 'euclid']));
    });
    onCleanup(() => {
      setReferenceStore('expanded', new Set<string>());
      setReferenceStore('data', []);
      setReferenceStore('isLoading', true);
    });
    return (
      <div style={{ width: '100%', 'max-width': '720px', height: '640px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
        <ModuLispReferenceTab />
      </div>
    );
  },
};

/** Starred entries sort to the top of the list. */
export const StarredEntries: Story = {
  render: () => {
    onMount(() => {
      setReferenceStore('data', SAMPLE_ENTRIES);
      setReferenceStore('isLoading', false);
      setReferenceStore('starred', new Set(['euclid', 'tri']));
    });
    onCleanup(() => {
      setReferenceStore('starred', new Set<string>());
      setReferenceStore('data', []);
      setReferenceStore('isLoading', true);
    });
    return (
      <div style={{ width: '100%', 'max-width': '720px', height: '640px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
        <ModuLispReferenceTab />
      </div>
    );
  },
};

/**
 * Target firmware version pinned to 1.0.5 — entries introduced after that
 * (e.g. `euclid` in 1.1.0) are visually marked as not-yet-available.
 */
export const TargetVersion: Story = {
  render: () => {
    onMount(() => {
      setReferenceStore('data', SAMPLE_ENTRIES);
      setReferenceStore('isLoading', false);
      setReferenceStore('targetVersion', '1.0.5');
    });
    onCleanup(() => {
      setReferenceStore('targetVersion', null);
      setReferenceStore('data', []);
      setReferenceStore('isLoading', true);
    });
    return (
      <div style={{ width: '100%', 'max-width': '720px', height: '640px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
        <ModuLispReferenceTab />
      </div>
    );
  },
};
