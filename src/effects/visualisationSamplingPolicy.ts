// Runtime sampling bounds and projection-relevant settings identity. App
// settings persistence is normalized separately in lib/settings; this layer
// applies the stricter limits required by the live sampling/rendering loop.

import {
  DEFAULT_VIS_SETTINGS,
  type VisSettings,
} from "../utils/visualisationStore.ts";

// Individual default values, derived from the canonical defaults in the
// visualisation store, for call sites that need one setting in isolation.
export const DEFAULT_FUTURE_LEAD_SECONDS = DEFAULT_VIS_SETTINGS.futureLeadSeconds;
export const DEFAULT_HISTORY_HEADROOM = DEFAULT_VIS_SETTINGS.historyHeadroom;
export const DEFAULT_MAX_HISTORY_SECONDS = DEFAULT_VIS_SETTINGS.maxHistorySeconds;
export const DEFAULT_INPUT_EPSILON = DEFAULT_VIS_SETTINGS.inputEpsilon;
const MAX_FUTURE_LEAD_SECONDS = 8;

export function resolveVisualisationSamplingPolicy(raw: Partial<VisSettings> | null): VisSettings {
  const defaults = defaultVisualisationSettings();
  const safe: VisSettings = { ...defaults, ...(raw || {}) };
  safe.showFutureProjection = safe.showFutureProjection === true;
  safe.windowDuration = Math.min(20, Math.max(1, Number(safe.windowDuration) || defaults.windowDuration));
  safe.sampleCount = Math.max(2, Math.min(400, Math.floor(Number(safe.sampleCount) || defaults.sampleCount)));
  safe.lineWidth = Math.min(5, Math.max(0.5, Number(safe.lineWidth) || defaults.lineWidth));
  safe.futureDashed = safe.futureDashed !== false;
  safe.futureMaskOpacity = clampNumber(safe.futureMaskOpacity, 0, 1, defaults.futureMaskOpacity);
  safe.futureMaskWidth = Math.min(
    48,
    Math.max(4, Number(safe.futureMaskWidth) || defaults.futureMaskWidth),
  );
  safe.circularOffset = finiteNumber(safe.circularOffset, defaults.circularOffset, Math.round);
  safe.futureLeadSeconds = clampNumber(
    safe.futureLeadSeconds,
    0,
    MAX_FUTURE_LEAD_SECONDS,
    DEFAULT_FUTURE_LEAD_SECONDS,
  );
  safe.digitalLaneGap = clampNumber(safe.digitalLaneGap, 0, 40, defaults.digitalLaneGap);
  safe.futureLineAlpha = clampNumber(safe.futureLineAlpha, 0, 1, defaults.futureLineAlpha);
  safe.minFutureSampleRate = clampNumber(safe.minFutureSampleRate, 1, 120, defaults.minFutureSampleRate);
  safe.extensionBatchSize = Math.floor(clampNumber(safe.extensionBatchSize, 1, 32, defaults.extensionBatchSize));
  safe.temporalSampleRateMultiplier = clampNumber(
    safe.temporalSampleRateMultiplier,
    0.05,
    1,
    defaults.temporalSampleRateMultiplier,
  );
  safe.inputEpsilon = clampNumber(safe.inputEpsilon, 0, 1, defaults.inputEpsilon);
  safe.historyHeadroom = minimumNumber(safe.historyHeadroom, 0, defaults.historyHeadroom);
  safe.maxHistorySeconds = minimumNumber(safe.maxHistorySeconds, 1, defaults.maxHistorySeconds);
  return safe;
}

export function projectionSettingsKey(settings: VisSettings): string {
  return JSON.stringify({
    windowDuration: settings.windowDuration,
    sampleCount: settings.sampleCount,
    futureLeadSeconds: settings.futureLeadSeconds,
    minFutureSampleRate: settings.minFutureSampleRate,
  });
}

function defaultVisualisationSettings(): VisSettings {
  return { ...DEFAULT_VIS_SETTINGS };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function minimumNumber(value: unknown, min: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, numeric) : fallback;
}

function finiteNumber(value: unknown, fallback: number, map: (value: number) => number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? map(numeric) : fallback;
}
