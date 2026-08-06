// Runtime sampling bounds and projection-relevant settings identity. App
// settings persistence is normalized separately in lib/settings; this layer
// applies the stricter limits required by the live sampling/rendering loop.

import type { VisSettings } from "../utils/visualisationStore.ts";

export const DEFAULT_FUTURE_LEAD_SECONDS = 1;
export const DEFAULT_HISTORY_HEADROOM = 5;
export const DEFAULT_MAX_HISTORY_SECONDS = 30;
export const DEFAULT_INPUT_EPSILON = 0.01;
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
  return {
    showFutureProjection: false,
    windowDuration: 10,
    sampleCount: 100,
    lineWidth: 1.5,
    futureDashed: true,
    futureMaskOpacity: 0.35,
    futureMaskWidth: 12,
    circularOffset: 0,
    futureLeadSeconds: DEFAULT_FUTURE_LEAD_SECONDS,
    digitalLaneGap: 4,
    futureLineAlpha: 0.6,
    minFutureSampleRate: 30,
    extensionBatchSize: 4,
    temporalSampleRateMultiplier: 1,
    inputEpsilon: DEFAULT_INPUT_EPSILON,
    historyHeadroom: DEFAULT_HISTORY_HEADROOM,
    maxHistorySeconds: DEFAULT_MAX_HISTORY_SECONDS,
  };
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
