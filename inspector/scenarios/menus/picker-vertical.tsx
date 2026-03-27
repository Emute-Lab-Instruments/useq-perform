import { defineScenario } from '../../framework/scenario';
import { PickerMenu } from '@src/ui/PickerMenu';

const items = [
  { label: 'Load snippet' },
  { label: 'Save snippet' },
  { label: 'Export to clipboard' },
  { label: 'Import from file' },
];

export default defineScenario({
  category: 'Modals & Overlays / Picker Menu',
  name: 'Vertical layout (real)',
  type: 'contract',
  sourceFiles: ['src/ui/PickerMenu.tsx'],
  description:
    'Real PickerMenu in vertical single-column layout with 4 action items. Hover or use arrow keys to navigate.',
  component: {
    render: () => (
      <PickerMenu
        items={items}
        onSelect={() => {}}
        onClose={() => {}}
        title="Snippets"
        layout="vertical"
        initialIndex={1}
      />
    ),
    loadAppStyles: true,
    width: 280,
    height: 260,
  },
});
