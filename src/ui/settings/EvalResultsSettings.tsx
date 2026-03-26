import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Select, NumberInput, Checkbox } from "./FormControls";

const modeOptions = [
  { value: "console", label: "Console only" },
  { value: "inline", label: "Inline (persistent)" },
  { value: "inline-ephemeral", label: "Inline (auto-dismiss)" },
  { value: "floating", label: "Floating tooltip" },
];

export function EvalResultsSettings() {
  const current = () => settings.evalResults ?? {
    mode: "inline-ephemeral",
    autoDismissMs: 3000,
    maxChars: 200,
    showTimestamp: false,
  };

  const handleModeChange = (mode: string) => {
    updateSettingsStore({
      evalResults: { ...current(), mode: mode as any },
    });
  };

  const handleAutoDismissChange = (autoDismissMs: number) => {
    if (autoDismissMs >= 0) {
      updateSettingsStore({
        evalResults: { ...current(), autoDismissMs },
      });
    }
  };

  const handleMaxCharsChange = (maxChars: number) => {
    if (maxChars >= 0) {
      updateSettingsStore({
        evalResults: { ...current(), maxChars },
      });
    }
  };

  const handleShowTimestampChange = (showTimestamp: boolean) => {
    updateSettingsStore({
      evalResults: { ...current(), showTimestamp },
    });
  };

  return (
    <Section title="Eval Results">
      <FormRow label="Display mode">
        <Select
          value={current().mode}
          options={modeOptions}
          onChange={handleModeChange}
        />
      </FormRow>
      <FormRow label="Auto-dismiss (ms)">
        <NumberInput
          value={current().autoDismissMs}
          min={0}
          max={30000}
          step={500}
          disabled={current().mode === "console" || current().mode === "inline"}
          onChange={handleAutoDismissChange}
        />
      </FormRow>
      <FormRow label="Max display chars">
        <NumberInput
          value={current().maxChars}
          min={0}
          max={1000}
          step={10}
          onChange={handleMaxCharsChange}
        />
      </FormRow>
      <FormRow label="Show timestamp">
        <Checkbox
          checked={current().showTimestamp}
          onChange={handleShowTimestampChange}
        />
      </FormRow>
    </Section>
  );
}
