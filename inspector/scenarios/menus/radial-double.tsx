import { defineScenario } from '../../framework/scenario';
import { DoubleRadialPicker, type PickerCategory } from '@src/ui/DoubleRadialPicker';

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

export default defineScenario({
  category: 'Modals & Overlays / Radial Menu',
  name: 'Double radial picker (real)',
  type: 'contract',
  sourceFiles: ['src/ui/DoubleRadialPicker.tsx'],
  description:
    'Real DoubleRadialPicker with cyan left ring (categories) and rose right ring (items). Hover segments to navigate; click to select.',
  component: {
    render: () => (
      <DoubleRadialPicker
        title="Insert Expression"
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
        menuSize={280}
        innerRadiusRatio={0.35}
      />
    ),
    loadAppStyles: true,
    width: 700,
    height: 500,
  },
});
