import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { HierarchicalPickerMenu, type HierarchicalCategory } from '@src/ui/HierarchicalPickerMenu';

const sampleCategories: HierarchicalCategory[] = [
  {
    id: 'oscillators',
    label: 'Oscillators',
    items: [
      { label: 'sine', value: 'sine', insertText: '(sine )' },
      { label: 'saw', value: 'saw', insertText: '(saw )' },
      { label: 'square', value: 'square', insertText: '(square )' },
      { label: 'triangle', value: 'tri', insertText: '(tri )' },
      { label: 'pulse', value: 'pulse', insertText: '(pulse )' },
      { label: 'noise', value: 'noise', insertText: '(noise )' },
    ],
  },
  {
    id: 'filters',
    label: 'Filters',
    items: [
      { label: 'low-pass', value: 'lpf', insertText: '(lpf )' },
      { label: 'high-pass', value: 'hpf', insertText: '(hpf )' },
      { label: 'band-pass', value: 'bpf', insertText: '(bpf )' },
      { label: 'notch', value: 'notch', insertText: '(notch )' },
    ],
  },
  {
    id: 'envelopes',
    label: 'Envelopes',
    items: [
      { label: 'ADSR', value: 'adsr', insertText: '(adsr )' },
      { label: 'AR', value: 'ar', insertText: '(ar )' },
      { label: 'env', value: 'env', insertText: '(env )' },
    ],
  },
  {
    id: 'numbers',
    label: 'Literals',
    items: [
      { label: 'Number…', value: 'number', special: 'number' },
    ],
  },
];

const meta: Meta = {
  title: 'Menus/Hierarchical Picker',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <HierarchicalPickerMenu
      categories={sampleCategories}
      title="Insert Expression"
      onSelect={(item) => console.log('Selected:', item)}
      onClose={() => console.log('Closed')}
    />
  ),
};
