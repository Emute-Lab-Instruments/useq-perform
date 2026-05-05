import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore";
import { Section, FormRow, Select, NumberInput } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface KeybindingsSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function KeybindingsSettings(props: KeybindingsSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);

  const updateField = (field: string, value: string | number | boolean) => {
    update({
      keybindings: {
        ...s().keybindings,
        [field]: value,
      },
    });
  };

  return (
    <Section title="Keybindings">
      <FormRow label="Modifier hint style">
        <Select
          value={(s().keybindings?.modifierHintStyle as string) || "cursor"}
          options={[
            { value: "cursor", label: "Cursor (floating popup)" },
            { value: "bar", label: "Bar (bottom panel)" },
            { value: "modal", label: "Modal (full overlay)" },
          ]}
          onChange={(val) => updateField("modifierHintStyle", val)}
        />
      </FormRow>
      <FormRow label="Modifier hint delay (ms)">
        <NumberInput
          value={s().keybindings?.modifierHintDelay ?? 500}
          min={0}
          max={2000}
          onChange={(val) => updateField("modifierHintDelay", val)}
        />
      </FormRow>
      <FormRow label="Chord timeout (ms)" level="advanced">
        <NumberInput
          value={s().keybindings?.chordTimeout ?? 1500}
          min={200}
          max={5000}
          onChange={(val) => updateField("chordTimeout", val)}
        />
      </FormRow>
    </Section>
  );
}
