// Capacity, allocation and lookup owner for faithful-past/projected-future
// visualisation buffers. Sampling policy and WASM execution live elsewhere.

import { PastBuffer } from "../lib/PastBuffer.ts";
import { visStore, type VisSettings } from "../utils/visualisationStore.ts";
import {
  DEFAULT_HISTORY_HEADROOM,
  DEFAULT_MAX_HISTORY_SECONDS,
} from "./visualisationSamplingPolicy.ts";

const ASSUMED_FRAME_RATE = 30;
const MIN_FUTURE_CAPACITY = DEFAULT_MAX_HISTORY_SECONDS * ASSUMED_FRAME_RATE;
const MAX_FUTURE_CAPACITY = 8192;

let pastBufferSampleRate = ASSUMED_FRAME_RATE;
let futureBufferCapacity = MIN_FUTURE_CAPACITY;
const pastBuffers = new Map<string, PastBuffer>();
const futureBuffers = new Map<string, PastBuffer>();

export interface OutputRenderData {
  pastBuffer: PastBuffer;
  futureBuffer: PastBuffer | undefined;
}

export function getPastBufferSampleRate(): number {
  return pastBufferSampleRate;
}

export function getTemporalSampleRate(): number {
  const multiplier = visStore.settings.temporalSampleRateMultiplier ?? 1;
  return Math.max(1, pastBufferSampleRate * multiplier);
}

export function setPastBufferSampleRate(hz: number): void {
  const numeric = Number(hz);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  const next = Math.max(1, Math.round(numeric));
  if (next === pastBufferSampleRate) return;
  pastBufferSampleRate = next;

  const newCapacity = pastCapacity();
  for (const [key, oldBuffer] of pastBuffers) {
    pastBuffers.set(key, copyNewest(oldBuffer, newCapacity));
  }
}

export function futureProjectionSampleRate(settings: VisSettings): number {
  return Math.max(
    settings.minFutureSampleRate,
    (settings.sampleCount || 100) / (settings.windowDuration || 1),
  );
}

export function configureFutureBufferCapacity(settings: VisSettings): void {
  const settingsCapacity = Math.ceil(
    (settings.windowDuration + (settings.futureLeadSeconds || 0)) *
      futureProjectionSampleRate(settings) * 1.5,
  );
  futureBufferCapacity = Math.min(
    MAX_FUTURE_CAPACITY,
    Math.max(MIN_FUTURE_CAPACITY, settingsCapacity),
  );
}

export function ensurePastBuffer(exprType: string): PastBuffer {
  let buffer = pastBuffers.get(exprType);
  if (!buffer) {
    buffer = new PastBuffer(pastCapacity());
    pastBuffers.set(exprType, buffer);
  }
  return buffer;
}

export function ensureFutureBuffer(exprType: string): PastBuffer {
  let buffer = futureBuffers.get(exprType);
  if (!buffer || buffer.capacity < futureBufferCapacity) {
    buffer = buffer
      ? copyNewest(buffer, futureBufferCapacity)
      : new PastBuffer(futureBufferCapacity);
    futureBuffers.set(exprType, buffer);
  }
  return buffer;
}

export function futureBufferFor(exprType: string): PastBuffer | undefined {
  return futureBuffers.get(exprType);
}

export function clearFutureBuffer(exprType: string): void {
  futureBuffers.get(exprType)?.clear();
}

export function destroyVisualisationBuffers(exprType: string): void {
  pastBuffers.delete(exprType);
  futureBuffers.delete(exprType);
}

export function getRenderData(exprType: string): OutputRenderData | null {
  const pastBuffer = pastBuffers.get(exprType);
  if (!pastBuffer) return null;
  return { pastBuffer, futureBuffer: futureBuffers.get(exprType) };
}

function pastCapacity(): number {
  const settings = visStore.settings;
  const windowDuration = Number.isFinite(settings.windowDuration) ? settings.windowDuration : 10;
  const headroom = Number.isFinite(settings.historyHeadroom)
    ? settings.historyHeadroom
    : DEFAULT_HISTORY_HEADROOM;
  const cap = Number.isFinite(settings.maxHistorySeconds)
    ? settings.maxHistorySeconds
    : DEFAULT_MAX_HISTORY_SECONDS;
  const retainedSeconds = Math.min(windowDuration / 2 + headroom, cap);
  return Math.max(1, Math.ceil(retainedSeconds * pastBufferSampleRate));
}

function copyNewest(buffer: PastBuffer, capacity: number): PastBuffer {
  const replacement = new PastBuffer(capacity);
  const start = Math.max(0, buffer.length - capacity);
  for (let i = start; i < buffer.length; i++) {
    replacement.push(buffer.timeAt(i), buffer.valueAt(i));
  }
  return replacement;
}
