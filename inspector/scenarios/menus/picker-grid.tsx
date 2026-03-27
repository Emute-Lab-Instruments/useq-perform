import { defineScenario } from '../../framework/scenario';
import { PickerMenu } from '@src/ui/PickerMenu';

const items = [
  { label: 'Sine', value: 'sine' },
  { label: 'Square', value: 'square' },
  { label: 'Triangle', value: 'triangle' },
  { label: 'Saw', value: 'saw' },
  { label: 'Pulse', value: 'pulse' },
  { label: 'Noise', value: 'noise' },
];

export default defineScenario({
  category: 'Modals & Overlays / Picker Menu',
  name: 'Grid layout (real)',
  type: 'contract',
  sourceFiles: ['src/ui/PickerMenu.tsx'],
  description:
    'Real PickerMenu in 3-column grid layout with 6 waveform items. Hover or use arrow keys to navigate; click to select.',
  component: {
    render: () => (
      <PickerMenu
        items={items}
        onSelect={() => {}}
        onClose={() => {}}
        title="Select Waveform"
        layout="grid"
        initialIndex={1}
      />
    ),
    loadAppStyles: true,
    width: 350,
    height: 300,
  },
});
