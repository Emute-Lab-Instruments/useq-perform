import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox } from "./shared";

export function AdvancedSettings() {
  const handleWasmEnabledChange = (enabled: boolean) => {
    updateSettingsStore({
      wasm: {
        ...settings.wasm,
        enabled,
      },
    });
  };

  return (
    <Section title="Advanced Settings">
      <FormRow label="Enable WASM Interpreter">
        <Checkbox
          checked={settings.wasm?.enabled !== false}
          onChange={handleWasmEnabledChange}
        />
      </FormRow>
    </Section>
  );
}
