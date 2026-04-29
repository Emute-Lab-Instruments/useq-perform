import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput, Select } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface UISettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function UISettings(props: UISettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);

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
      <FormRow label="Console Line Limit" level="advanced">
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
      <FormRow label="Track last expression per type" level="advanced">
        <Checkbox
          checked={s().ui?.expressionLastTrackingEnabled !== false}
          onChange={(val) => updateUIField("expressionLastTrackingEnabled", val)}
        />
      </FormRow>
      <FormRow label="Show clear (×) button on active expression" level="advanced">
        <Checkbox
          checked={s().ui?.expressionClearButtonEnabled !== false}
          onChange={(val) => updateUIField("expressionClearButtonEnabled", val)}
        />
      </FormRow>
      <FormRow label="Gamepad Picker Style" level="advanced">
        <Select
          value={s().ui?.gamepadPickerStyle || "grid"}
          options={[
            { value: "grid", label: "Grid (D-pad, nested)" },
            { value: "radial", label: "Radial (dual sticks)" },
          ]}
          onChange={(val) => updateUIField("gamepadPickerStyle", val)}
        />
      </FormRow>
      <FormRow label="Node highlight corner radius" level="advanced">
        <NumberInput
          value={s().ui?.nodeHighlightCornerRadius ?? 3}
          min={0}
          max={20}
          onChange={(val) => updateUIField("nodeHighlightCornerRadius", val)}
        />
      </FormRow>
      <FormRow label="Node highlight Y offset" level="advanced">
        <NumberInput
          value={s().ui?.nodeHighlightYOffset ?? 0}
          min={-10}
          max={10}
          onChange={(val) => updateUIField("nodeHighlightYOffset", val)}
        />
      </FormRow>
      <FormRow label="Show indent guide">
        <Checkbox
          checked={s().ui?.indentGuideEnabled !== false}
          onChange={(val) => updateUIField("indentGuideEnabled", val)}
        />
      </FormRow>
      <FormRow label="Indent guide width" level="advanced">
        <NumberInput
          value={s().ui?.indentGuideWidth ?? 1}
          min={0.5}
          max={5}
          step={0.5}
          onChange={(val) => updateUIField("indentGuideWidth", val)}
        />
      </FormRow>
      <FormRow label="Indent guide opacity" level="advanced">
        <NumberInput
          value={s().ui?.indentGuideOpacity ?? 0.15}
          min={0}
          max={1}
          step={0.05}
          onChange={(val) => updateUIField("indentGuideOpacity", val)}
        />
      </FormRow>
      <FormRow label="Indent guide luminosity" level="advanced">
        <NumberInput
          value={s().ui?.indentGuideLuminosity ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          onChange={(val) => updateUIField("indentGuideLuminosity", val)}
        />
      </FormRow>
      <FormRow label="Indent guide dash" level="advanced">
        <NumberInput
          value={s().ui?.indentGuideDash ?? 4}
          min={1}
          max={20}
          onChange={(val) => updateUIField("indentGuideDash", val)}
        />
      </FormRow>
      <FormRow label="Indent guide gap" level="advanced">
        <NumberInput
          value={s().ui?.indentGuideGap ?? 4}
          min={1}
          max={20}
          onChange={(val) => updateUIField("indentGuideGap", val)}
        />
      </FormRow>
      <FormRow label="Indent guide Y padding" level="advanced">
        <NumberInput
          value={s().ui?.indentGuideYPadding ?? 2}
          min={0}
          max={20}
          onChange={(val) => updateUIField("indentGuideYPadding", val)}
        />
      </FormRow>
    </Section>
  );
}