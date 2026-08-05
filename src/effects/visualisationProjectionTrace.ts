import { projectionTrace } from "../lib/projectionTrace";
import type { PastBuffer } from "../lib/PastBuffer";
import type { VisSample } from "../utils/visualisationStore";

export function summarizeFutureBuffer(
  buffer: PastBuffer | undefined,
  currentTime: number,
): Record<string, unknown> {
  if (!buffer) return { length: 0, exists: false };

  let firstFutureTime: number | null = null;
  let firstFutureValue: number | null = null;
  let firstFutureIndex: number | null = null;
  let expiredCount = 0;
  for (let index = 0; index < buffer.length; index++) {
    const time = buffer.timeAt(index);
    if (time <= currentTime) {
      expiredCount++;
      continue;
    }
    firstFutureTime = time;
    firstFutureValue = buffer.valueAt(index);
    firstFutureIndex = index;
    break;
  }
  return {
    exists: true,
    length: buffer.length,
    capacity: buffer.capacity,
    oldestTime: buffer.oldestTime,
    newestTime: buffer.newestTime,
    expiredCount,
    firstFutureIndex,
    firstFutureTime,
    firstFutureValue,
    firstFutureGap: firstFutureTime === null
      ? null
      : firstFutureTime - currentTime,
  };
}

export function summarizeProjectionSamples(
  samples: VisSample[] | undefined,
  currentTime: number,
): Record<string, unknown> {
  if (!samples?.length) return { count: 0 };

  let firstFiniteIndex: number | null = null;
  let lastFiniteIndex: number | null = null;
  let nonFiniteIndex: number | null = null;
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index].value;
    if (!Number.isFinite(value)) {
      nonFiniteIndex ??= index;
      continue;
    }
    firstFiniteIndex ??= index;
    lastFiniteIndex = index;
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const detail: Record<string, unknown> = {
    count: samples.length,
    firstTime: first.time,
    firstGap: first.time - currentTime,
    firstValue: first.value,
    lastTime: last.time,
    lastGap: last.time - currentTime,
    lastValue: last.value,
    firstFiniteIndex,
    lastFiniteIndex,
    nonFiniteIndex,
    minValue: minValue === Infinity ? null : minValue,
    maxValue: maxValue === -Infinity ? null : maxValue,
  };
  if (projectionTrace.shouldCaptureSamples()) {
    detail.samples = samples.map((sample) => ({
      time: sample.time,
      gap: sample.time - currentTime,
      value: sample.value,
    }));
  }
  return detail;
}
