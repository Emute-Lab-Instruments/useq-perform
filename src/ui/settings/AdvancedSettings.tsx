import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox } from "./FormControls";

export function AdvancedSettings() {
  const handleAutoReconnectChange = (autoReconnect: boolean) => {
    updateSettingsStore({
      runtime: {
        ...settings.runtime,
        autoReconnect,
      },
    });
  };

  const handleStartLocallyWithoutHardwareChange = (startLocallyWithoutHardware: boolean) => {
    updateSettingsStore({
      runtime: {
        ...settings.runtime,
        startLocallyWithoutHardware,
      },
    });
  };

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
      <FormRow label="Reconnect saved hardware on startup">
        <Checkbox
          checked={settings.runtime?.autoReconnect !== false}
          onChange={handleAutoReconnectChange}
        />
      </FormRow>
      <FormRow label="Start locally before hardware connects">
        <Checkbox
          checked={settings.runtime?.startLocallyWithoutHardware !== false}
          onChange={handleStartLocallyWithoutHardwareChange}
        />
      </FormRow>
      <FormRow label="Enable WASM Interpreter">
        <Checkbox
          checked={settings.wasm?.enabled !== false}
          onChange={handleWasmEnabledChange}
        />
      </FormRow>
    </Section>
  );
}
