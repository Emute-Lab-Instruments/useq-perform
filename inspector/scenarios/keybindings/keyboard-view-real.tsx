import { defineScenario } from '../../framework/scenario';
import KeyboardVisualiser from '@src/ui/keybindings/KeyboardVisualiser';
import { defaultKeyBindings } from '@src/lib/keybindings/defaults';

export default defineScenario({
  category: 'Keybindings / Keyboard Visualiser',
  name: 'View mode — real component (QWERTY US)',
  type: 'contract',
  sourceFiles: [
    'src/ui/keybindings/KeyboardVisualiser.tsx',
    'src/lib/keybindings/defaults.ts',
    'src/lib/keybindings/actions.ts',
  ],
  description:
    'Real KeyboardVisualiser rendered in view mode with default bindings on QWERTY US layout. ' +
    'Verify colour-coded keys by action category, legend at bottom, and tooltip on hover.',
  component: {
    render: () => (
      <KeyboardVisualiser
        layout="qwerty-us"
        bindings={defaultKeyBindings}
        showLegend={true}
      />
    ),
    loadAppStyles: true,
    width: 700,
    height: 400,
  },
});
