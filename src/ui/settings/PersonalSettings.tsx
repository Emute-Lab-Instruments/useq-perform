import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, TextInput } from "./FormControls";

export function PersonalSettings() {
  return (
    <Section title="Personal Settings">
      <FormRow label="Your Name">
        <TextInput
          value={settings.name || ""}
          placeholder="Enter your name"
          onChange={(name) => updateSettingsStore({ name })}
        />
      </FormRow>
    </Section>
  );
}
