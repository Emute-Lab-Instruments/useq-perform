import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, TextInput } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface PersonalSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function PersonalSettings(props: PersonalSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  return (
    <Section title="Personal Settings">
      <FormRow label="Your Name">
        <TextInput
          value={s().name || ""}
          placeholder="Enter your name"
          onChange={(name) => update({ name })}
        />
      </FormRow>
    </Section>
  );
}
