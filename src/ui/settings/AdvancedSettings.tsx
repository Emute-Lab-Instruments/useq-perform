import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, Select } from "./FormControls";
import type { AppSettings } from "../../lib/appSettings.ts";
import type { FailureMode, FormatSettings } from "../../lib/settings/schema.ts";

export interface AdvancedSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function AdvancedSettings(props: AdvancedSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);

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

  const handleFailureModeChange = (failureMode: FailureMode) => {
    update({
      runtime: {
        ...s().runtime,
        failureMode,
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

  const handleAutoFormatStrategyChange = (
    value: FormatSettings["autoFormatStrategy"],
  ) => {
    update({
      format: {
        ...s().format,
        autoFormatStrategy: value,
      },
    });
  };

  return (
    <Section title="Advanced Settings" level="advanced">
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
      <FormRow label="Non-finite failure policy">
        <Select
          value={s().runtime?.failureMode ?? "lkg"}
          options={[
            { value: "lkg", label: "Last-known-good fallback (default)" },
            { value: "zero", label: "Zero-squash (legacy)" },
          ]}
          onChange={(v) => handleFailureModeChange(v as FailureMode)}
        />
      </FormRow>
      <FormRow label="Enable WASM Interpreter">
        <Checkbox
          checked={s().wasm?.enabled !== false}
          onChange={handleWasmEnabledChange}
        />
      </FormRow>
      <FormRow label="Auto-format after structural edit (experimental)">
        <Select
          value={s().format?.autoFormatStrategy ?? "reflow"}
          options={[
            { value: "off", label: "Off (flat output)" },
            { value: "reflow", label: "Reflow (§3 width + complexity)" },
            {
              value: "indent-fixed-point",
              label: "Indent to fixed point (Tab × N)",
            },
          ]}
          onChange={(v) =>
            handleAutoFormatStrategyChange(
              v as FormatSettings["autoFormatStrategy"],
            )
          }
        />
      </FormRow>
    </Section>
  );
}
