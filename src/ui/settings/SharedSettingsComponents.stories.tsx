import type { Meta, StoryObj } from "@storybook/html";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { 
  Section, 
  FormRow, 
  TextInput, 
  NumberInput, 
  Checkbox, 
  Select, 
  RangeInput 
} from "./FormControls";

const meta: Meta = {
  title: "UI/Settings/Shared",
  tags: ["autodocs"],
  render: () => {
    const container = document.createElement("div");
    container.className = "panel-tab-content";
    
    const Component = () => {
      const [text, setText] = createSignal("Hello");
      const [num, setNum] = createSignal(10);
      const [checked, setChecked] = createSignal(true);
      const [selected, setSelected] = createSignal("opt1");
      const [range, setRange] = createSignal(5);

      return (
        <Section title="Shared Components Demo">
          <FormRow label="Text Input">
            <TextInput value={text()} onChange={setText} />
          </FormRow>
          
          <FormRow label="Number Input">
            <NumberInput value={num()} onChange={setNum} />
          </FormRow>
          
          <FormRow label="Checkbox">
            <Checkbox checked={checked()} onChange={setChecked} />
          </FormRow>
          
          <FormRow label="Select">
            <Select 
              value={selected()} 
              options={[
                { value: "opt1", label: "Option 1" },
                { value: "opt2", label: "Option 2" }
              ]} 
              onChange={setSelected} 
            />
          </FormRow>
          
          <FormRow label="Range Input">
            <RangeInput 
              value={range()} 
              min={0} 
              max={10} 
              step={1} 
              formatValue={(v) => `${v} units`}
              onChange={setRange} 
            />
          </FormRow>
        </Section>
      );
    };

    render(() => <Component />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};
