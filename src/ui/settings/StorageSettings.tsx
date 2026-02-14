import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput } from "./shared";

export function StorageSettings() {
  const handleSaveLocallyChange = (saveCodeLocally: boolean) => {
    updateSettingsStore({
      storage: {
        ...settings.storage,
        saveCodeLocally,
      },
    });
  };

  const handleAutoSaveEnabledChange = (autoSaveEnabled: boolean) => {
    updateSettingsStore({
      storage: {
        ...settings.storage,
        autoSaveEnabled,
      },
    });
  };

  const handleAutoSaveIntervalChange = (autoSaveInterval: number) => {
    if (autoSaveInterval >= 1000 && autoSaveInterval <= 60000) {
      updateSettingsStore({
        storage: {
          ...settings.storage,
          autoSaveInterval,
        },
      });
    }
  };

  return (
    <Section title="Storage Settings">
      <FormRow label="Save Code Locally">
        <Checkbox
          checked={settings.storage?.saveCodeLocally !== false}
          onChange={handleSaveLocallyChange}
        />
      </FormRow>
      <FormRow label="Auto-Save Enabled">
        <Checkbox
          checked={settings.storage?.autoSaveEnabled !== false}
          onChange={handleAutoSaveEnabledChange}
        />
      </FormRow>
      <FormRow label="Auto-Save Interval (ms)">
        <NumberInput
          value={settings.storage?.autoSaveInterval || 5000}
          min={1000}
          max={60000}
          step={1000}
          disabled={settings.storage?.autoSaveEnabled === false}
          onChange={handleAutoSaveIntervalChange}
        />
      </FormRow>
    </Section>
  );
}
