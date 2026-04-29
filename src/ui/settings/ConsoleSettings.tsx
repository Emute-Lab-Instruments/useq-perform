import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput, Select } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface ConsoleSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function ConsoleSettings(props: ConsoleSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);

  const updateField = (field: string, value: string | number | boolean) => {
    update({
      console: {
        ...s().console,
        [field]: value,
      },
    });
  };

  return (
    <Section title="Console">
      <FormRow label="Show timestamp">
        <Checkbox
          checked={s().console?.showTimestamp !== false}
          onChange={(val) => updateField("showTimestamp", val)}
        />
      </FormRow>
      <FormRow label="Show message type badge" level="advanced">
        <Checkbox
          checked={s().console?.showTypeBadge !== false}
          onChange={(val) => updateField("showTypeBadge", val)}
        />
      </FormRow>
      <FormRow label="New entry animation">
        <Select
          value={s().console?.entryAnimation || "slide"}
          options={[
            { value: "slide", label: "Slide in" },
            { value: "fade", label: "Fade in" },
            { value: "typewriter", label: "Typewriter" },
            { value: "none", label: "None" },
          ]}
          onChange={(val) => updateField("entryAnimation", val)}
        />
      </FormRow>
      <FormRow label="Typewriter speed (ms/char)" level="advanced">
        <NumberInput
          value={s().console?.typewriterIntervalMs ?? 20}
          min={1}
          max={200}
          disabled={s().console?.entryAnimation !== "typewriter"}
          onChange={(val) => updateField("typewriterIntervalMs", val)}
        />
      </FormRow>
    </Section>
  );
}
