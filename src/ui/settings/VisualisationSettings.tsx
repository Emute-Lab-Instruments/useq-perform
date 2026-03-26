import type { VisualisationSettings as AppVisualisationSettings } from "../../lib/appSettings.ts";
import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Checkbox, NumberInput, RangeInput } from "./FormControls";
import { serialVisChannels } from "../../lib/visualisationUtils.ts";

export function VisualisationSettings() {
  const updateVisField = <K extends keyof AppVisualisationSettings>(
    field: K,
    value: AppVisualisationSettings[K],
  ) => {
    updateSettingsStore({
      visualisation: {
        ...settings.visualisation,
        [field]: value,
      },
    });
  };

  const offsetRangeLength = () => Math.max(1, serialVisChannels?.length || 1);
  const maxCircularOffset = () => offsetRangeLength() - 1;
  const safeCircularOffset = () => {
    const raw = Number(settings.visualisation?.circularOffset ?? 0);
    const len = offsetRangeLength();
    return ((raw % len) + len) % len;
  };

  return (
    <Section title="Visualisation Settings">
      <FormRow label="Visible window duration">
        <RangeInput
          value={settings.visualisation?.windowDuration ?? 10}
          min={1}
          max={20}
          step={0.5}
          formatValue={(v) => `${v.toFixed(1)}s`}
          onChange={(val) => updateVisField("windowDuration", val)}
        />
      </FormRow>
      <FormRow label="Future lead window">
        <RangeInput
          value={settings.visualisation?.futureLeadSeconds ?? 1}
          min={0}
          max={8}
          step={0.5}
          formatValue={(v) => `${v.toFixed(1)}s`}
          onChange={(val) => updateVisField("futureLeadSeconds", val)}
        />
      </FormRow>
      <FormRow label="Visible sample count">
        <NumberInput
          value={settings.visualisation?.sampleCount ?? 100}
          min={10}
          max={400}
          step={10}
          onChange={(val) => updateVisField("sampleCount", val)}
        />
      </FormRow>
      <FormRow label="Waveform line width">
        <RangeInput
          value={settings.visualisation?.lineWidth ?? 1.5}
          min={0.5}
          max={5}
          step={0.1}
          formatValue={(v) => `${v.toFixed(2)}px`}
          onChange={(val) => updateVisField("lineWidth", val)}
        />
      </FormRow>
      <FormRow label="Probe waveform line width">
        <RangeInput
          value={settings.visualisation?.probeLineWidth ?? 2}
          min={0.5}
          max={5}
          step={0.1}
          formatValue={(v) => `${v.toFixed(2)}px`}
          onChange={(val) => updateVisField("probeLineWidth", val)}
        />
      </FormRow>
      <FormRow label="Probe sample count">
        <NumberInput
          value={settings.visualisation?.probeSampleCount ?? 40}
          min={10}
          max={400}
          step={10}
          onChange={(val) => updateVisField("probeSampleCount", val)}
        />
      </FormRow>
      <FormRow label="Probe refresh rate">
        <RangeInput
          value={1000 / (settings.visualisation?.probeRefreshIntervalMs ?? 33)}
          min={1}
          max={60}
          step={1}
          formatValue={(v) => `${Math.round(v)} fps`}
          onChange={(val) =>
            updateVisField(
              "probeRefreshIntervalMs",
              Math.max(16, Math.round(1000 / Math.max(1, val))),
            )}
        />
      </FormRow>
      <FormRow label="Digital channel gap">
        <RangeInput
          value={settings.visualisation?.digitalLaneGap ?? 4}
          min={0}
          max={40}
          step={1}
          formatValue={(v) => `${Math.round(v)}px`}
          onChange={(val) => updateVisField("digitalLaneGap", val)}
        />
      </FormRow>
      <FormRow label="Color circular offset">
        <RangeInput
          value={safeCircularOffset()}
          min={0}
          max={maxCircularOffset()}
          step={1}
          disabled={maxCircularOffset() === 0}
          onChange={(val) => updateVisField("circularOffset", val)}
        />
      </FormRow>
      <FormRow label="Readability blur">
        <Checkbox
          checked={settings.visualisation?.readabilityEnabled !== false}
          onChange={(val) => updateVisField("readabilityEnabled", val)}
        />
      </FormRow>
      <FormRow label="Blur intensity">
        <RangeInput
          value={settings.visualisation?.readabilityBlurRadius ?? 10}
          min={1}
          max={30}
          step={1}
          disabled={settings.visualisation?.readabilityEnabled === false}
          formatValue={(v) => `${Math.round(v)}px`}
          onChange={(val) => updateVisField("readabilityBlurRadius", val)}
        />
      </FormRow>
      <FormRow label="Darken waveforms">
        <RangeInput
          value={settings.visualisation?.readabilityTintOpacity ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          disabled={settings.visualisation?.readabilityEnabled === false}
          formatValue={(v) => v.toFixed(2)}
          onChange={(val) => updateVisField("readabilityTintOpacity", val)}
        />
      </FormRow>
      <FormRow label="Overall opacity">
        <RangeInput
          value={settings.visualisation?.readabilityAlpha ?? 0.85}
          min={0}
          max={1}
          step={0.05}
          disabled={settings.visualisation?.readabilityEnabled === false}
          formatValue={(v) => v.toFixed(2)}
          onChange={(val) => updateVisField("readabilityAlpha", val)}
        />
      </FormRow>
      <FormRow label="Blur padding">
        <RangeInput
          value={settings.visualisation?.readabilityPadding ?? 3}
          min={0}
          max={20}
          step={1}
          disabled={settings.visualisation?.readabilityEnabled === false}
          formatValue={(v) => `${Math.round(v)}px`}
          onChange={(val) => updateVisField("readabilityPadding", val)}
        />
      </FormRow>
      <FormRow label="Show future mask/dashes">
        <Checkbox
          checked={settings.visualisation?.futureDashed !== false}
          onChange={(val) => updateVisField("futureDashed", val)}
        />
      </FormRow>
      <FormRow label="Future shading intensity">
        <RangeInput
          value={settings.visualisation?.futureMaskOpacity ?? 0.35}
          min={0}
          max={1}
          step={0.05}
          disabled={settings.visualisation?.futureDashed === false}
          formatValue={(v) => v.toFixed(2)}
          onChange={(val) => updateVisField("futureMaskOpacity", val)}
        />
      </FormRow>
      <FormRow label="Future mask stripe width">
        <RangeInput
          value={settings.visualisation?.futureMaskWidth ?? 12}
          min={4}
          max={40}
          step={1}
          disabled={settings.visualisation?.futureDashed === false}
          formatValue={(v) => `${v}px`}
          onChange={(val) => updateVisField("futureMaskWidth", val)}
        />
      </FormRow>
    </Section>
  );
}
