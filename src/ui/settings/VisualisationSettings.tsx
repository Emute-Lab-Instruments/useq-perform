import type { VisualisationSettings as AppVisualisationSettings, AppSettings } from "../../lib/appSettings.ts";
import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, SubGroup, FormRow, Checkbox, NumberInput, RangeInput } from "./FormControls";
import { serialVisChannels } from "../../lib/visualisationUtils.ts";

export interface VisualisationSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
}

export function VisualisationSettings(props: VisualisationSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  const updateVisField = <K extends keyof AppVisualisationSettings>(
    field: K,
    value: AppVisualisationSettings[K],
  ) => {
    update({
      visualisation: {
        ...s().visualisation,
        [field]: value,
      },
    });
  };

  const offsetRangeLength = () => Math.max(1, serialVisChannels?.length || 1);
  const maxCircularOffset = () => offsetRangeLength() - 1;
  const safeCircularOffset = () => {
    const raw = Number(s().visualisation?.circularOffset ?? 0);
    const len = offsetRangeLength();
    return ((raw % len) + len) % len;
  };

  return (
    <Section title="Visualisation">
      <SubGroup label="Waveform display">
        <FormRow label="Visible window duration">
          <RangeInput
            value={s().visualisation?.windowDuration ?? 10}
            min={1}
            max={20}
            step={0.5}
            formatValue={(v) => `${v.toFixed(1)}s`}
            onChange={(val) => updateVisField("windowDuration", val)}
          />
        </FormRow>
        <FormRow label="Future lead window">
          <RangeInput
            value={s().visualisation?.futureLeadSeconds ?? 1}
            min={0}
            max={8}
            step={0.5}
            formatValue={(v) => `${v.toFixed(1)}s`}
            onChange={(val) => updateVisField("futureLeadSeconds", val)}
          />
        </FormRow>
        <FormRow label="Visible sample count">
          <NumberInput
            value={s().visualisation?.sampleCount ?? 100}
            min={10}
            max={400}
            step={10}
            onChange={(val) => updateVisField("sampleCount", val)}
          />
        </FormRow>
        <FormRow label="Waveform line width">
          <RangeInput
            value={s().visualisation?.lineWidth ?? 1.5}
            min={0.5}
            max={5}
            step={0.1}
            formatValue={(v) => `${v.toFixed(2)}px`}
            onChange={(val) => updateVisField("lineWidth", val)}
          />
        </FormRow>
        <FormRow label="Digital channel gap">
          <RangeInput
            value={s().visualisation?.digitalLaneGap ?? 4}
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
      </SubGroup>

      <SubGroup label="Probes">
        <FormRow label="Probe waveform line width">
          <RangeInput
            value={s().visualisation?.probeLineWidth ?? 2}
            min={0.5}
            max={5}
            step={0.1}
            formatValue={(v) => `${v.toFixed(2)}px`}
            onChange={(val) => updateVisField("probeLineWidth", val)}
          />
        </FormRow>
        <FormRow label="Probe sample count">
          <NumberInput
            value={s().visualisation?.probeSampleCount ?? 40}
            min={10}
            max={400}
            step={10}
            onChange={(val) => updateVisField("probeSampleCount", val)}
          />
        </FormRow>
        <FormRow label="Probe refresh rate">
          <RangeInput
            value={1000 / (s().visualisation?.probeRefreshIntervalMs ?? 33)}
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
      </SubGroup>

      <SubGroup label="Readability" defaultOpen={false}>
        <FormRow label="Enable readability blur">
          <Checkbox
            checked={s().visualisation?.readabilityEnabled !== false}
            onChange={(val) => updateVisField("readabilityEnabled", val)}
          />
        </FormRow>
        <FormRow label="Blur intensity">
          <RangeInput
            value={s().visualisation?.readabilityBlurRadius ?? 10}
            min={1}
            max={30}
            step={1}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => `${Math.round(v)}px`}
            onChange={(val) => updateVisField("readabilityBlurRadius", val)}
          />
        </FormRow>
        <FormRow label="Darken waveforms">
          <RangeInput
            value={s().visualisation?.readabilityTintOpacity ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => v.toFixed(2)}
            onChange={(val) => updateVisField("readabilityTintOpacity", val)}
          />
        </FormRow>
        <FormRow label="Overall opacity">
          <RangeInput
            value={s().visualisation?.readabilityAlpha ?? 0.85}
            min={0}
            max={1}
            step={0.05}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => v.toFixed(2)}
            onChange={(val) => updateVisField("readabilityAlpha", val)}
          />
        </FormRow>
        <FormRow label="Mask tightness">
          <RangeInput
            value={s().visualisation?.readabilityPadding ?? 3}
            min={0}
            max={30}
            step={1}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => `${Math.round(v)}px`}
            onChange={(val) => updateVisField("readabilityPadding", val)}
          />
        </FormRow>
        <FormRow label="Edge feather">
          <RangeInput
            value={s().visualisation?.readabilityFeather ?? 4}
            min={0}
            max={20}
            step={1}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => `${Math.round(v)}px`}
            onChange={(val) => updateVisField("readabilityFeather", val)}
          />
        </FormRow>
        <FormRow label="Density passes">
          <RangeInput
            value={s().visualisation?.readabilityPasses ?? 2}
            min={0}
            max={5}
            step={1}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => `${Math.round(v)}`}
            onChange={(val) => updateVisField("readabilityPasses", val)}
          />
        </FormRow>
        <FormRow label="Max darken">
          <RangeInput
            value={s().visualisation?.readabilityMaxDarken ?? 0.85}
            min={0}
            max={1}
            step={0.05}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => v.toFixed(2)}
            onChange={(val) => updateVisField("readabilityMaxDarken", val)}
          />
        </FormRow>
        <FormRow label="Scroll rebuild delay">
          <RangeInput
            value={s().visualisation?.readabilityDebounceMs ?? 80}
            min={20}
            max={300}
            step={10}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => `${Math.round(v)}ms`}
            onChange={(val) => updateVisField("readabilityDebounceMs", val)}
          />
        </FormRow>
        <FormRow label="Scroll overscan">
          <RangeInput
            value={s().visualisation?.readabilityOverscan ?? 30}
            min={0}
            max={100}
            step={5}
            disabled={s().visualisation?.readabilityEnabled === false}
            formatValue={(v) => `${Math.round(v)} lines`}
            onChange={(val) => updateVisField("readabilityOverscan", val)}
          />
        </FormRow>
      </SubGroup>

      <SubGroup label="Future region" defaultOpen={false}>
        <FormRow label="Show future mask/dashes">
          <Checkbox
            checked={s().visualisation?.futureDashed !== false}
            onChange={(val) => updateVisField("futureDashed", val)}
          />
        </FormRow>
        <FormRow label="Shading intensity">
          <RangeInput
            value={s().visualisation?.futureMaskOpacity ?? 0.35}
            min={0}
            max={1}
            step={0.05}
            disabled={s().visualisation?.futureDashed === false}
            formatValue={(v) => v.toFixed(2)}
            onChange={(val) => updateVisField("futureMaskOpacity", val)}
          />
        </FormRow>
        <FormRow label="Mask stripe width">
          <RangeInput
            value={s().visualisation?.futureMaskWidth ?? 12}
            min={4}
            max={40}
            step={1}
            disabled={s().visualisation?.futureDashed === false}
            formatValue={(v) => `${v}px`}
            onChange={(val) => updateVisField("futureMaskWidth", val)}
          />
        </FormRow>
      </SubGroup>
    </Section>
  );
}
