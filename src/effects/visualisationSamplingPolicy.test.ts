import { describe, expect, it } from "vitest";

import {
  resolveVisualisationSamplingPolicy,
  projectionSettingsKey,
} from "./visualisationSamplingPolicy.ts";

describe("visualisation sampling policy", () => {
  it("supplies the complete production defaults", () => {
    expect(resolveVisualisationSamplingPolicy(null)).toMatchObject({
      showFutureProjection: false,
      windowDuration: 10,
      sampleCount: 100,
      futureLeadSeconds: 1,
      minFutureSampleRate: 30,
      temporalSampleRateMultiplier: 1,
      historyHeadroom: 5,
      maxHistorySeconds: 30,
    });
  });

  it("clamps bounded sampling and drawing values", () => {
    expect(resolveVisualisationSamplingPolicy({
      windowDuration: 100,
      sampleCount: -3,
      lineWidth: 99,
      futureLeadSeconds: -2,
      temporalSampleRateMultiplier: 0,
    })).toMatchObject({
      windowDuration: 20,
      sampleCount: 2,
      lineWidth: 5,
      futureLeadSeconds: 0,
      temporalSampleRateMultiplier: 0.05,
    });
  });

  it("preserves the historical zero-mask-width fallback", () => {
    expect(resolveVisualisationSamplingPolicy({ futureMaskWidth: 0 }).futureMaskWidth).toBe(12);
  });

  it("rounds the circular palette offset and projection batch size", () => {
    expect(resolveVisualisationSamplingPolicy({
      circularOffset: 2.6,
      extensionBatchSize: 3.9,
    })).toMatchObject({ circularOffset: 3, extensionBatchSize: 3 });
  });

  it("projection identity ignores paint-only settings", () => {
    const base = resolveVisualisationSamplingPolicy(null);
    expect(projectionSettingsKey({ ...base, lineWidth: 4 })).toBe(projectionSettingsKey(base));
  });

  it("projection identity changes with future sampling policy", () => {
    const base = resolveVisualisationSamplingPolicy(null);
    expect(projectionSettingsKey({ ...base, futureLeadSeconds: 2 })).not.toBe(
      projectionSettingsKey(base),
    );
  });
});
