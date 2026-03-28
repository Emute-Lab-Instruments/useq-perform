import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { FormRow, NumberInput, Section, SubGroup, Checkbox } from '@src/ui/settings/FormControls';

function NumberInputWrapper() {
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
}

function CollapsibleSectionsWrapper() {
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
}

const meta: Meta = {
  title: 'Settings/Form Controls',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const DragAdjustNumber: Story = {
  render: () => <NumberInputWrapper />,
};

export const CollapsibleSections: Story = {
  render: () => <CollapsibleSectionsWrapper />,
};
