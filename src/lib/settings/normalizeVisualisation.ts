/**
 * Visualisation Settings Normalization
 *
 * Validation and normalization for visualisation-related settings.
 */

import type { VisualisationSettings } from "./schema.ts";
import { defaultUserSettings } from "./schema.ts";
import { isRecord, coerceNumber } from "./normalizationHelpers.ts";

export function normalizeVisualisationSettings(
  value: unknown,
  defaults: VisualisationSettings = defaultUserSettings.visualisation,
): VisualisationSettings {
  const raw = isRecord(value) ? value : {};

  return {
    showFutureProjection:
      raw.showFutureProjection == null ? defaults.showFutureProjection : raw.showFutureProjection !== false,
    windowDuration: coerceNumber(raw.windowDuration, defaults.windowDuration),
    sampleCount: coerceNumber(raw.sampleCount, defaults.sampleCount),
    lineWidth: coerceNumber(raw.lineWidth, defaults.lineWidth),
    probeSampleCount: coerceNumber(
      raw.probeSampleCount,
      defaults.probeSampleCount,
    ),
    probeLineWidth: coerceNumber(raw.probeLineWidth, defaults.probeLineWidth),
    probeRefreshIntervalMs: coerceNumber(
      raw.probeRefreshIntervalMs,
      defaults.probeRefreshIntervalMs,
    ),
    futureDashed:
      raw.futureDashed == null ? defaults.futureDashed : raw.futureDashed !== false,
    futureMaskOpacity: coerceNumber(raw.futureMaskOpacity, defaults.futureMaskOpacity),
    futureMaskWidth: coerceNumber(raw.futureMaskWidth, defaults.futureMaskWidth),
    circularOffset: coerceNumber(raw.circularOffset, defaults.circularOffset),
    futureLeadSeconds: coerceNumber(raw.futureLeadSeconds, defaults.futureLeadSeconds),
    digitalLaneGap: coerceNumber(raw.digitalLaneGap, defaults.digitalLaneGap),
    fromListHighlights:
      raw.fromListHighlights == null ? defaults.fromListHighlights : raw.fromListHighlights !== false,
    probeDefaultWindowDurationMs: coerceNumber(
      raw.probeDefaultWindowDurationMs,
      defaults.probeDefaultWindowDurationMs,
    ),
    historyHeadroom: coerceNumber(raw.historyHeadroom, defaults.historyHeadroom),
    maxHistorySeconds: coerceNumber(raw.maxHistorySeconds, defaults.maxHistorySeconds),
    inputEpsilon: coerceNumber(raw.inputEpsilon, defaults.inputEpsilon),
    readabilityBlurRadius: coerceNumber(raw.readabilityBlurRadius, defaults.readabilityBlurRadius),
    readabilityPadding: coerceNumber(raw.readabilityPadding, defaults.readabilityPadding),
    readabilityTintOpacity: coerceNumber(raw.readabilityTintOpacity, defaults.readabilityTintOpacity),
    readabilityAlpha: coerceNumber(raw.readabilityAlpha, defaults.readabilityAlpha),
    readabilityPasses: coerceNumber(raw.readabilityPasses, defaults.readabilityPasses),
    readabilityFeather: coerceNumber(raw.readabilityFeather, defaults.readabilityFeather),
    readabilityMaxDarken: coerceNumber(raw.readabilityMaxDarken, defaults.readabilityMaxDarken),
    readabilityDebounceMs: coerceNumber(raw.readabilityDebounceMs, defaults.readabilityDebounceMs),
    readabilityOverscan: coerceNumber(raw.readabilityOverscan, defaults.readabilityOverscan),
    readabilityEnabled:
      raw.readabilityEnabled == null ? defaults.readabilityEnabled : raw.readabilityEnabled !== false,
    adaptiveQuality:
      raw.adaptiveQuality == null ? defaults.adaptiveQuality : raw.adaptiveQuality !== false,
    futureLineAlpha: coerceNumber(raw.futureLineAlpha, defaults.futureLineAlpha),
    minFutureSampleRate: coerceNumber(raw.minFutureSampleRate, defaults.minFutureSampleRate),
    extensionBatchSize: coerceNumber(raw.extensionBatchSize, defaults.extensionBatchSize),
    temporalSampleRateMultiplier: coerceNumber(
      raw.temporalSampleRateMultiplier,
      defaults.temporalSampleRateMultiplier,
    ),
    snippetOscilloscopesEnabled:
      raw.snippetOscilloscopesEnabled == null
        ? defaults.snippetOscilloscopesEnabled
        : raw.snippetOscilloscopesEnabled === true,
  };
}

/**
 * Extract a partial visualisation settings patch from a raw record.
 * Used by settingsPatchFromConfiguration to build incremental patches.
 */
export function extractVisualisationPatch(
  visualisation: Record<string, unknown>,
): Partial<VisualisationSettings> {
  const patch: Partial<VisualisationSettings> = {};
  const defaults = defaultUserSettings.visualisation;

  if ("showFutureProjection" in visualisation) {
    patch.showFutureProjection = visualisation.showFutureProjection !== false;
  }

  if ("windowDuration" in visualisation) {
    patch.windowDuration = normalizeVisualisationSettings(
      { windowDuration: visualisation.windowDuration },
      defaults,
    ).windowDuration;
  }

  if ("sampleCount" in visualisation) {
    patch.sampleCount = coerceNumber(visualisation.sampleCount, defaults.sampleCount);
  }

  if ("lineWidth" in visualisation) {
    patch.lineWidth = coerceNumber(visualisation.lineWidth, defaults.lineWidth);
  }

  if ("probeSampleCount" in visualisation) {
    patch.probeSampleCount = coerceNumber(visualisation.probeSampleCount, defaults.probeSampleCount);
  }

  if ("probeLineWidth" in visualisation) {
    patch.probeLineWidth = coerceNumber(visualisation.probeLineWidth, defaults.probeLineWidth);
  }

  if ("probeRefreshIntervalMs" in visualisation) {
    patch.probeRefreshIntervalMs = coerceNumber(visualisation.probeRefreshIntervalMs, defaults.probeRefreshIntervalMs);
  }

  if ("futureDashed" in visualisation) {
    patch.futureDashed = visualisation.futureDashed !== false;
  }

  if ("futureMaskOpacity" in visualisation) {
    patch.futureMaskOpacity = coerceNumber(visualisation.futureMaskOpacity, defaults.futureMaskOpacity);
  }

  if ("futureMaskWidth" in visualisation) {
    patch.futureMaskWidth = coerceNumber(visualisation.futureMaskWidth, defaults.futureMaskWidth);
  }

  if ("circularOffset" in visualisation) {
    patch.circularOffset = coerceNumber(visualisation.circularOffset, defaults.circularOffset);
  }

  if ("futureLeadSeconds" in visualisation) {
    patch.futureLeadSeconds = coerceNumber(visualisation.futureLeadSeconds, defaults.futureLeadSeconds);
  }

  if ("digitalLaneGap" in visualisation) {
    patch.digitalLaneGap = coerceNumber(visualisation.digitalLaneGap, defaults.digitalLaneGap);
  }

  if ("fromListHighlights" in visualisation) {
    patch.fromListHighlights = visualisation.fromListHighlights !== false;
  }

  if ("probeDefaultWindowDurationMs" in visualisation) {
    patch.probeDefaultWindowDurationMs = coerceNumber(
      visualisation.probeDefaultWindowDurationMs,
      defaults.probeDefaultWindowDurationMs,
    );
  }

  if ("historyHeadroom" in visualisation) {
    patch.historyHeadroom = coerceNumber(visualisation.historyHeadroom, defaults.historyHeadroom);
  }

  if ("maxHistorySeconds" in visualisation) {
    patch.maxHistorySeconds = coerceNumber(visualisation.maxHistorySeconds, defaults.maxHistorySeconds);
  }

  if ("inputEpsilon" in visualisation) {
    patch.inputEpsilon = coerceNumber(visualisation.inputEpsilon, defaults.inputEpsilon);
  }

  if ("readabilityBlurRadius" in visualisation) {
    patch.readabilityBlurRadius = coerceNumber(visualisation.readabilityBlurRadius, defaults.readabilityBlurRadius);
  }

  if ("readabilityPadding" in visualisation) {
    patch.readabilityPadding = coerceNumber(visualisation.readabilityPadding, defaults.readabilityPadding);
  }

  if ("readabilityTintOpacity" in visualisation) {
    patch.readabilityTintOpacity = coerceNumber(visualisation.readabilityTintOpacity, defaults.readabilityTintOpacity);
  }

  if ("readabilityAlpha" in visualisation) {
    patch.readabilityAlpha = coerceNumber(visualisation.readabilityAlpha, defaults.readabilityAlpha);
  }

  if ("readabilityPasses" in visualisation) {
    patch.readabilityPasses = coerceNumber(visualisation.readabilityPasses, defaults.readabilityPasses);
  }

  if ("readabilityFeather" in visualisation) {
    patch.readabilityFeather = coerceNumber(visualisation.readabilityFeather, defaults.readabilityFeather);
  }

  if ("readabilityMaxDarken" in visualisation) {
    patch.readabilityMaxDarken = coerceNumber(visualisation.readabilityMaxDarken, defaults.readabilityMaxDarken);
  }

  if ("readabilityDebounceMs" in visualisation) {
    patch.readabilityDebounceMs = coerceNumber(visualisation.readabilityDebounceMs, defaults.readabilityDebounceMs);
  }

  if ("readabilityOverscan" in visualisation) {
    patch.readabilityOverscan = coerceNumber(visualisation.readabilityOverscan, defaults.readabilityOverscan);
  }

  if ("readabilityEnabled" in visualisation) {
    patch.readabilityEnabled = visualisation.readabilityEnabled !== false;
  }

  if ("adaptiveQuality" in visualisation) {
    patch.adaptiveQuality = visualisation.adaptiveQuality !== false;
  }

  if ("futureLineAlpha" in visualisation) {
    patch.futureLineAlpha = coerceNumber(visualisation.futureLineAlpha, defaults.futureLineAlpha);
  }

  if ("minFutureSampleRate" in visualisation) {
    patch.minFutureSampleRate = coerceNumber(visualisation.minFutureSampleRate, defaults.minFutureSampleRate);
  }

  if ("extensionBatchSize" in visualisation) {
    patch.extensionBatchSize = coerceNumber(visualisation.extensionBatchSize, defaults.extensionBatchSize);
  }

  if ("temporalSampleRateMultiplier" in visualisation) {
    patch.temporalSampleRateMultiplier = coerceNumber(
      visualisation.temporalSampleRateMultiplier,
      defaults.temporalSampleRateMultiplier,
    );
  }

  if ("snippetOscilloscopesEnabled" in visualisation) {
    patch.snippetOscilloscopesEnabled =
      visualisation.snippetOscilloscopesEnabled === true;
  }

  return patch;
}
