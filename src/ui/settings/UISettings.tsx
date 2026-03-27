import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput, Select } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface UISettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function UISettings(props: UISettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  const handleConsoleLinesLimitChange = (consoleLinesLimit: number) => {
    if (consoleLinesLimit >= 100 && consoleLinesLimit <= 10000) {
      update({
        ui: {
          ...s().ui,
          consoleLinesLimit,
        },
      });
    }
  };

  const updateUIField = (field: string, value: string | number | boolean) => {
    update({
      ui: {
        ...s().ui,
        [field]: value,
      },
    });
  };

  return (
    <Section title="UI Settings">
      <FormRow label="Console Line Limit">
        <NumberInput
          value={s().ui?.consoleLinesLimit || 1000}
          min={100}
          max={10000}
          onChange={handleConsoleLinesLimitChange}
        />
      </FormRow>
      <FormRow label="Show expression gutter bars">
        <Checkbox
          checked={s().ui?.expressionGutterEnabled !== false}
          onChange={(val) => updateUIField("expressionGutterEnabled", val)}
        />
      </FormRow>
      <FormRow label="Track last expression per type">
        <Checkbox
          checked={s().ui?.expressionLastTrackingEnabled !== false}
          onChange={(val) => updateUIField("expressionLastTrackingEnabled", val)}
        />
      </FormRow>
      <FormRow label="Show clear (×) button on active expression">
        <Checkbox
          checked={s().ui?.expressionClearButtonEnabled !== false}
          onChange={(val) => updateUIField("expressionClearButtonEnabled", val)}
        />
      </FormRow>
      <FormRow label="Gamepad Picker Style">
        <Select
          value={s().ui?.gamepadPickerStyle || "grid"}
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