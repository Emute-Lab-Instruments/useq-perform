import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput, Select } from "./shared";

export function UISettings() {
  const handleConsoleLinesLimitChange = (consoleLinesLimit: number) => {
    if (consoleLinesLimit >= 100 && consoleLinesLimit <= 10000) {
      updateSettingsStore({
        ui: {
          ...settings.ui,
          consoleLinesLimit,
        },
      });
    }
  };

  const updateUIField = (field: string, value: any) => {
    updateSettingsStore({
      ui: {
        ...settings.ui,
        [field]: value,
      },
    });
  };

  return (
    <Section title="UI Settings">
      <FormRow label="Console Line Limit">
        <NumberInput
          value={settings.ui?.consoleLinesLimit || 1000}
          min={100}
          max={10000}
          onChange={handleConsoleLinesLimitChange}
        />
      </FormRow>
      <FormRow label="Show expression gutter bars">
        <Checkbox
          checked={settings.ui?.expressionGutterEnabled !== false}
          onChange={(val) => updateUIField("expressionGutterEnabled", val)}
        />
      </FormRow>
      <FormRow label="Track last expression per type">
        <Checkbox
          checked={settings.ui?.expressionLastTrackingEnabled !== false}
          onChange={(val) => updateUIField("expressionLastTrackingEnabled", val)}
        />
      </FormRow>
      <FormRow label="Show clear (×) button on active expression">
        <Checkbox
          checked={settings.ui?.expressionClearButtonEnabled !== false}
          onChange={(val) => updateUIField("expressionClearButtonEnabled", val)}
        />
      </FormRow>
      <FormRow label="Gamepad Picker Style">
        <Select
          value={settings.ui?.gamepadPickerStyle || "grid"}
          options={[
            { value: "grid", label: "Grid (D-pad, nested)" },
            { value: "radial", label: "Radial (dual sticks)" },
          ]}
          onChange={(val) => updateUIField("gamepadPickerStyle", val)}
        />
      </FormRow>
    </Section>
  );
}