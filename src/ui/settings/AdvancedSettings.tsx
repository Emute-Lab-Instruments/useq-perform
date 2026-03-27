import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface AdvancedSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function AdvancedSettings(props: AdvancedSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  const handleAutoReconnectChange = (autoReconnect: boolean) => {
    update({
      runtime: {
        ...s().runtime,
        autoReconnect,
      },
    });
  };

  const handleStartLocallyWithoutHardwareChange = (startLocallyWithoutHardware: boolean) => {
    update({
      runtime: {
        ...s().runtime,
        startLocallyWithoutHardware,
      },
    });
  };

  const handleWasmEnabledChange = (enabled: boolean) => {
    update({
      wasm: {
        ...s().wasm,
        enabled,
      },
    });
  };

  return (
    <Section title="Advanced Settings">
      <FormRow label="Reconnect saved hardware on startup">
        <Checkbox
          checked={s().runtime?.autoReconnect !== false}
          onChange={handleAutoReconnectChange}
        />
      </FormRow>
      <FormRow label="Start locally before hardware connects">
        <Checkbox
          checked={s().runtime?.startLocallyWithoutHardware !== false}
          onChange={handleStartLocallyWithoutHardwareChange}
        />
      </FormRow>
      <FormRow label="Enable WASM Interpreter">
        <Checkbox
          checked={s().wasm?.enabled !== false}
          onChange={handleWasmEnabledChange}
        />
      </FormRow>
    </Section>
  );
}
