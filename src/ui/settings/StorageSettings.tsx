import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface StorageSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function StorageSettings(props: StorageSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  const handleSaveLocallyChange = (saveCodeLocally: boolean) => {
    update({
      storage: {
        ...s().storage,
        saveCodeLocally,
      },
    });
  };

  const handleAutoSaveEnabledChange = (autoSaveEnabled: boolean) => {
    update({
      storage: {
        ...s().storage,
        autoSaveEnabled,
      },
    });
  };

  const handleAutoSaveIntervalChange = (autoSaveInterval: number) => {
    if (autoSaveInterval >= 1000 && autoSaveInterval <= 60000) {
      update({
        storage: {
          ...s().storage,
          autoSaveInterval,
        },
      });
    }
  };

  return (
    <Section title="Storage Settings">
      <FormRow label="Save Code Locally">
        <Checkbox
          checked={s().storage?.saveCodeLocally !== false}
          onChange={handleSaveLocallyChange}
        />
      </FormRow>
      <FormRow label="Auto-Save Enabled">
        <Checkbox
          checked={s().storage?.autoSaveEnabled !== false}
          onChange={handleAutoSaveEnabledChange}
        />
      </FormRow>
      <FormRow label="Auto-Save Interval (ms)">
        <NumberInput
          value={s().storage?.autoSaveInterval || 5000}
          min={1000}
          max={60000}
          step={1000}
          disabled={s().storage?.autoSaveEnabled === false}
          onChange={handleAutoSaveIntervalChange}
        />
      </FormRow>
    </Section>
  );
}
