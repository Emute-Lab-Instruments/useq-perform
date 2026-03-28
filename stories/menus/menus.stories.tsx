import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { RadialMenu } from '@src/ui/RadialMenu';
import { DoubleRadialPicker, type PickerCategory } from '@src/ui/DoubleRadialPicker';
import { PickerMenu } from '@src/ui/PickerMenu';

const meta: Meta = {
  title: 'Menus',
};
export default meta;
type Story = StoryObj;

/** Single radial menu ring. */
export const RadialSingle: Story = {
  render: () => {
    const [active, setActive] = createSignal<number | null>(null);
    const labels = ['d1', 'd2', 'd3', 'd4', 'a1', 'a2', 'a3', 'a4'];

    return (
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '16px',
        }}
      >
        <RadialMenu
          segmentCount={8}
          activeSegment={active()}
          onHoverSegment={setActive}
          onSelectSegment={() => {}}
          labels={labels}
          size={260}
          innerRadiusRatio={0.35}
          pointerEnabled={true}
        />
      </div>
    );
  },
};

/** Double radial picker with categories and items. */
export const RadialDouble: Story = {
  render: () => {
    const sampleCategories: PickerCategory[] = [
      {
        label: 'Oscillators',
        items: [
          { label: 'sine' },
          { label: 'square' },
          { label: 'triangle' },
          { label: 'saw' },
          { label: 'pulse' },
          { label: 'noise' },
        ],
      },
      {
        label: 'Filters',
        items: [
          { label: 'lpf' },
          { label: 'hpf' },
          { label: 'bpf' },
          { label: 'notch' },
        ],
      },
      {
        label: 'Envelopes',
        items: [
          { label: 'env' },
          { label: 'adsr' },
          { label: 'ar' },
        ],
      },
      {
        label: 'Math',
        items: [
          { label: '+' },
          { label: '-' },
          { label: '*' },
          { label: '/' },
          { label: 'mod' },
        ],
      },
      {
        label: 'Logic',
        items: [
          { label: 'if' },
          { label: 'and' },
          { label: 'or' },
          { label: 'not' },
        ],
      },
      {
        label: 'Timing',
        items: [
          { label: 'metro' },
          { label: 'delay' },
          { label: 'latch' },
          { label: 'hold' },
        ],
      },
    ];

    return (
      <DoubleRadialPicker
        title="Insert Expression"
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
        menuSize={280}
        innerRadiusRatio={0.35}
      />
    );
  },
};

/** PickerMenu in grid layout. */
export const PickerGrid: Story = {
  render: () => {
    const items = [
      { label: 'Sine', value: 'sine' },
      { label: 'Square', value: 'square' },
      { label: 'Triangle', value: 'triangle' },
      { label: 'Saw', value: 'saw' },
      { label: 'Pulse', value: 'pulse' },
      { label: 'Noise', value: 'noise' },
    ];

    return (
      <PickerMenu
        items={items}
        onSelect={() => {}}
        onClose={() => {}}
        title="Select Waveform"
        layout="grid"
        initialIndex={1}
      />
    );
  },
};

/** PickerMenu in vertical layout. */
export const PickerVertical: Story = {
  render: () => {
    const items = [
      { label: 'Load snippet' },
      { label: 'Save snippet' },
      { label: 'Export to clipboard' },
      { label: 'Import from file' },
    ];

    return (
      <PickerMenu
        items={items}
        onSelect={() => {}}
        onClose={() => {}}
        title="Snippets"
        layout="vertical"
        initialIndex={1}
      />
    );
  },
};
