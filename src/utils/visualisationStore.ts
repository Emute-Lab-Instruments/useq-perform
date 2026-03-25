import { createStore, reconcile } from "solid-js/store";
import { visualisationSessionChannel } from "../contracts/visualisationChannels";
import type { VisualisationSessionDetail } from "../contracts/visualisationEvents";

// Channel definitions matching legacy serialVis/utils.mjs
export const SERIAL_VIS_CHANNELS = [
  "a1",
  "a2",
  "a3",
  "a4",
  "d1",
  "d2",
  "d3",
] as const;

export type SerialVisChannel = (typeof SERIAL_VIS_CHANNELS)[number];

export const DIGITAL_CHANNELS: readonly SerialVisChannel[] = ["d1", "d2", "d3"];

export interface VisSample {
  time: number;
  value: number;
}

export interface VisExpression {
  exprType: string;
  expressionText: string;
  samples: VisSample[];
  color: string | null;
  /** Position range of this expression in the editor (from line, to line). */
  position?: { from: number; to: number };
}

export interface VisSettings {
  windowDuration: number;
  sampleCount: number;
  lineWidth: number;
  futureDashed: boolean;
  futureMaskOpacity: number;
  futureMaskWidth: number;
  circularOffset: number;
  futureLeadSeconds: number;
  digitalLaneGap: number;
}

export interface SerialBufferSnapshot {
  /** Channel data arrays, oldest-first. Index 0 = time, 1..8 = channels. */
  channels: number[][];
  /** Number of valid samples per channel. */
  lengths: number[];
}

export interface VisualisationState {
  /** Current simulation time from the stream parser / mock generator. */
  currentTime: number;
  /** Display-clock time (currently same as currentTime). */
  displayTime: number;
  /** Rendering settings. */
  settings: VisSettings;
  /** Registered wasm-evaluated expressions keyed by exprType. */
  expressions: Record<string, VisExpression>;
  /** Bar position (0..1). */
  bar: number;
  /** Kind of the most recent update (e.g. "data", "time", "register"). */
  lastChangeKind: string;
  /** Serial buffer snapshots for raw-data vis. */
  serialBuffers: SerialBufferSnapshot;
  /** Current colour palette for serial vis channels. */
  palette: string[];
}

/**
 * Named session type for cross-layer consumption.
 */
export type VisualisationSession = VisualisationState;

const DEFAULT_SETTINGS: VisSettings = {
  windowDuration: 10,
  sampleCount: 100,
  lineWidth: 1.5,
  futureDashed: true,
  futureMaskOpacity: 0.35,
  futureMaskWidth: 12,
  circularOffset: 0,
  futureLeadSeconds: 1,
  digitalLaneGap: 4,
};

const EMPTY_SERIAL_BUFFERS: SerialBufferSnapshot = {
  channels: [],
  lengths: [],
};

const initialState: VisualisationState = {
  currentTime: 0,
  displayTime: 0,
  settings: { ...DEFAULT_SETTINGS },
  expressions: {},
  bar: 0,
  lastChangeKind: "",
  serialBuffers: EMPTY_SERIAL_BUFFERS,
  palette: [],
};

export const [visStore, setVisStore] =
  createStore<VisualisationState>(initialState);

// ---------------------------------------------------------------------------
// Mutation functions — these are the ONLY way to update vis state.
// The visualisationSampler and stream-parser call these directly.
// ---------------------------------------------------------------------------

/** Update the current simulation time. */
export function updateTime(timeSeconds: number): void {
  setVisStore("currentTime", timeSeconds);
  setVisStore("displayTime", timeSeconds);
}

/** Update the bar position (0..1). */
export function updateBar(bar: number): void {
  setVisStore("bar", bar);
}

/** Replace all expressions at once. */
export function updateExpressions(
  expressions: Record<string, VisExpression>,
): void {
  setVisStore("expressions", reconcile(expressions));
}

/** Remove a single expression by key. */
export function removeExpression(exprType: string): void {
  const { [exprType]: _, ...rest } = visStore.expressions;
  setVisStore("expressions", reconcile(rest));
}

/** Update rendering settings (full replace). */
export function updateSettings(settings: VisSettings): void {
  setVisStore("settings", reconcile(settings));
}

/** Set the last change kind tag. */
export function setLastChangeKind(
  kind: string,
  detail: VisualisationSessionDetail = {},
): void {
  setVisStore("lastChangeKind", kind);
  visualisationSessionChannel.publish({ ...detail, kind });
}

/**
 * Snapshot serial CircularBuffer instances into plain arrays for reactive
 * consumption. Call this from the serial-data update path.
 */
export function snapshotSerialBuffers(
  buffers: Array<{
    length: number;
    oldest(i: number): number;
    capacity: number;
  }>,
): void {
  const channels: number[][] = [];
  const lengths: number[] = [];

  for (const buf of buffers) {
    const len = buf.length;
    lengths.push(len);
    const arr: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = buf.oldest(i);
    }
    channels.push(arr);
  }

  setVisStore("serialBuffers", reconcile({ channels, lengths }));
}

/**
 * Update the colour palette (called when theme changes or palette is swapped).
 */
export function setVisPalette(palette: string[]): void {
  setVisStore("palette", reconcile([...palette]));
}
