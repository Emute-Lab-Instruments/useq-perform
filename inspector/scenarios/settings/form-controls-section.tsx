import { defineScenario } from '../../framework/scenario';
import { Section, SubGroup, FormRow, Checkbox, NumberInput } from '@src/ui/settings/FormControls';
import { createSignal } from 'solid-js';

export default defineScenario({
  category: 'Settings UI / Form Controls',
  name: 'Collapsible sections',
  type: 'canary',
  sourceFiles: ['src/ui/settings/FormControls.tsx'],
  description:
    'Collapsible Section with arrow toggle and nested SubGroup inside. ' +
    'First section is open by default, second is collapsed. ' +
    'Click section headers to toggle.',
  component: {
    render: () => {
      const [checkA, setCheckA] = createSignal(true);
      const [numVal, setNumVal] = createSignal(100);

      return (
        <div>
          <Section title="Advanced Options" defaultOpen={true}>
            <FormRow label="Setting A">
              <Checkbox checked={checkA()} onChange={setCheckA} />
            </FormRow>
            <SubGroup label="Nested Controls" defaultOpen={true}>
              <FormRow label="Nested value">
                <NumberInput
                  value={numVal()}
                  min={0}
                  max={500}
                  step={10}
                  onChange={setNumVal}
                />
              </FormRow>
            </SubGroup>
            <SubGroup label="More Options">
              <FormRow label="Another toggle">
                <Checkbox checked={false} onChange={() => {}} />
              </FormRow>
            </SubGroup>
          </Section>
          <Section title="Collapsed Section">
            <FormRow label="Hidden setting">
              <NumberInput value={42} min={0} max={100} onChange={() => {}} />
            </FormRow>
          </Section>
        </div>
      );
    },
    loadAppStyles: true,
    width: 400,
    height: 400,
  },
});
