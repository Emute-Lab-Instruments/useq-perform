// DOM- and WebGL-free planning for the serial visualisation renderer:
// lane layout, past/future sample assembly, and pixel-matched sample rate.

import { projectionTrace } from "../../lib/projectionTrace.ts";
import type { OutputRenderData, VisSettings } from "../../effects/visualisationSession.ts";
import type { VisSampleLike } from "./webglLineRenderer.ts";

const DIGITAL_OUTPUT_RE = /^[ds]\d+$/i;

export function isDigitalOutput(exprType: string): boolean {
  return DIGITAL_OUTPUT_RE.test(exprType);
}

export interface LaneBox {
  yTop: number;
  yBottom: number;
}

export interface LaneLayoutGeometry {
  readonly height: number;
  readonly verticalPadding: number;
  readonly laneGap: number;
}

export function computeLaneLayout(
  exprTypes: string[],
  geometry: LaneLayoutGeometry,
): Map<string, LaneBox> {
  const layout = new Map<string, LaneBox>();
  const drawableHeight = Math.max(0, geometry.height - geometry.verticalPadding * 2);
  const seen = new Set<string>();
  const analogue: string[] = [];
  const digital: string[] = [];
  for (const exprType of exprTypes) {
    if (seen.has(exprType)) continue;
    seen.add(exprType);
    (isDigitalOutput(exprType) ? digital : analogue).push(exprType);
  }

  const ordered = [...analogue, ...digital];
  if (ordered.length === 0 || drawableHeight <= 0) return layout;
  const laneGap = Math.max(0, Math.min(drawableHeight, geometry.laneGap || 0));
  const totalGapHeight = ordered.length > 1 ? laneGap * (ordered.length - 1) : 0;
  const laneHeight = Math.max(0, drawableHeight - totalGapHeight) / ordered.length;

  ordered.forEach((exprType, index) => {
    const yTop = geometry.verticalPadding + index * (laneHeight + laneGap);
    layout.set(exprType, { yTop, yBottom: yTop + laneHeight });
  });
  return layout;
}

const combinedScratch: VisSampleLike[] = [];
let combinedSplitIndex = 0;

export function getCombinedSplitIndex(): number {
  return combinedSplitIndex;
}

export function buildCombinedSamples(
  key: string,
  getRenderData: (exprType: string) => OutputRenderData | null,
  currentTime: number,
  maxFutureBoundaryGapSeconds = Infinity,
): VisSampleLike[] {
  combinedScratch.length = 0;
  combinedSplitIndex = 0;
  const data = getRenderData(key);
  if (!data) return combinedScratch;

  const { pastBuffer: past, futureBuffer: future } = data;
  let writeIndex = 0;
  let expiredFutureCount = 0;
  let keptFutureCount = 0;
  let firstFutureTime: number | null = null;
  let firstFutureValue: number | null = null;
  let firstFutureGap: number | null = null;
  let anchorInserted = false;
  let anchorSkippedDueGap = false;

  for (let i = 0; i < past.length; i++) {
    const slot = ensureCombinedSlot(writeIndex++);
    slot.time = past.timeAt(i);
    slot.value = past.valueAt(i);
  }
  combinedSplitIndex = writeIndex;

  let hasFuture = false;
  if (future) {
    for (let i = 0; i < future.length; i++) {
      const time = future.timeAt(i);
      if (time <= currentTime) {
        expiredFutureCount++;
        continue;
      }
      if (firstFutureTime === null) {
        firstFutureTime = time;
        firstFutureValue = future.valueAt(i);
        firstFutureGap = time - currentTime;
      }
      if (!hasFuture && combinedSplitIndex > 0) {
        if (time - currentTime <= maxFutureBoundaryGapSeconds) {
          const anchor = ensureCombinedSlot(writeIndex++);
          anchor.time = currentTime;
          anchor.value = combinedScratch[combinedSplitIndex - 1].value;
          anchorInserted = true;
        } else {
          anchorSkippedDueGap = true;
        }
        hasFuture = true;
      }
      const slot = ensureCombinedSlot(writeIndex++);
      slot.time = time;
      slot.value = future.valueAt(i);
      keptFutureCount++;
    }
  }
  combinedScratch.length = writeIndex;

  if (import.meta.env.DEV) {
    const detail: Record<string, unknown> = {
      output: key,
      currentTime,
      pastLength: past.length,
      futureLength: future?.length ?? 0,
      splitIndex: combinedSplitIndex,
      combinedLength: writeIndex,
      expiredFutureCount,
      keptFutureCount,
      firstFutureTime,
      firstFutureValue,
      firstFutureGap,
      maxFutureBoundaryGapSeconds,
      anchorInserted,
      anchorSkippedDueGap,
      pastNewestTime: past.newestTime,
      pastNewestGap: past.newestTime === -Infinity ? null : past.newestTime - currentTime,
      futureOldestTime: future?.oldestTime ?? null,
      futureNewestTime: future?.newestTime ?? null,
    };
    if (projectionTrace.shouldCaptureSamples()) {
      detail.combinedSamples = combinedScratch.map((sample) => ({
        time: sample.time,
        gap: sample.time - currentTime,
        value: sample.value,
      }));
    }
    projectionTrace.record("renderer-build", detail);
  }
  return combinedScratch;
}

export function futureBoundaryMaxGapSeconds(settings: VisSettings): number {
  const futureDensityHz = Math.max(
    settings.minFutureSampleRate || 1,
    (settings.sampleCount || 100) / (settings.windowDuration || 1),
  );
  return 4 / Math.max(1, futureDensityHz);
}

export function computeAdaptivePastBufferRate(
  canvasWidth: number,
  windowDurationSeconds: number,
  divisor: number,
  showFuture = true,
): number | null {
  const windowSeconds = windowDurationSeconds || 1;
  if (windowSeconds <= 0 || canvasWidth <= 0) return null;
  const pixelSpan = showFuture ? Math.floor(canvasWidth / 2) : canvasWidth;
  const timeSpan = showFuture ? windowSeconds / 2 : windowSeconds;
  const safeDivisor = divisor > 0 ? divisor : 1;
  const target = pixelSpan / timeSpan / safeDivisor;
  return target > 0 ? target : null;
}

function ensureCombinedSlot(index: number): VisSampleLike {
  let slot = combinedScratch[index];
  if (!slot) {
    slot = { time: 0, value: 0 };
    combinedScratch[index] = slot;
  }
  return slot;
}
