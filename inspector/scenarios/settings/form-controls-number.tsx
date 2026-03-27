import { defineScenario } from '../../framework/scenario';
import { createSignal } from 'solid-js';
import { FormRow, NumberInput } from '@src/ui/settings/FormControls';

export default defineScenario({
  category: 'Settings UI / Form Controls',
  name: 'Number input (drag-adjust)',
  type: 'canary',
  sourceFiles: ['src/ui/settings/FormControls.tsx'],
  description:
    'Number input that supports drag-to-adjust: dragging up increases the value, ' +
    'dragging down decreases it, and holding shift enables fine control. ' +
    'Click to type a value directly.',
  component: {
    render: () => {
      const [value, setValue] = createSignal(42);

      return (
        <div style={{ padding: '1rem' }}>
          <FormRow label="Drag-adjust value">
            <NumberInput
              value={value()}
              min={0}
              max={100}
              step={1}
              onChange={setValue}
            />
          </FormRow>
          <FormRow label="Font size (fine control)">
            <NumberInput
              value={16}
              min={8}
              max={32}
              step={1}
              onChange={() => {}}
            />
          </FormRow>
          <FormRow label="Disabled input">
            <NumberInput
              value={50}
              min={0}
              max={100}
              disabled={true}
              onChange={() => {}}
            />
          </FormRow>
        </div>
      );
    },
    loadAppStyles: true,
    width: 300,
    height: 250,
  },
});
