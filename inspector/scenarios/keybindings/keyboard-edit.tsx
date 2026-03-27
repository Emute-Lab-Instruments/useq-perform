import { defineScenario } from '../../framework/scenario';
import KeyboardVisualiser from '@src/ui/keybindings/KeyboardVisualiser';
import { defaultKeyBindings } from '@src/lib/keybindings/defaults';

/**
 * KeyboardVisualiser supports `mode="edit"` but it requires a `resolver` prop
 * (a BindingResolver instance) to enable edit functionality. Without a resolver,
 * `isEditMode()` returns false even with `mode="edit"`.
 *
 * This scenario renders the visualiser in view mode with the command list visible,
 * which is the closest approximation to "edit mode" without the resolver dependency.
 * The command list shows all bindings grouped by category, making it useful for
 * reviewing what could be rebound.
 */
export default defineScenario({
  category: 'Keybindings / Keyboard Visualiser',
  name: 'Edit mode — view with command list',
  type: 'canary',
  sourceFiles: [
    'src/ui/keybindings/KeyboardVisualiser.tsx',
    'src/lib/keybindings/defaults.ts',
    'src/lib/keybindings/resolver.ts',
  ],
  description:
    'KeyboardVisualiser rendered with the command list enabled. ' +
    'Full edit mode requires a BindingResolver (not yet injectable in Inspector). ' +
    'Verify keyboard layout renders alongside the categorised command list, ' +
    'colour-coded keys match command categories, and legend is visible.',
  component: {
    render: () => (
      <KeyboardVisualiser
        layout="qwerty-us"
        bindings={defaultKeyBindings}
        showLegend={true}
        showCommandList={true}
      />
    ),
    loadAppStyles: true,
    width: 900,
    height: 500,
  },
});
