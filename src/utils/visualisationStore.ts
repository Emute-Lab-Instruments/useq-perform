import { createStore, reconcile } from "solid-js/store";

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
  /** Current simulation time from the controller. */
  currentTime: number;
  /** Display-clock time (smoothed for rendering). */
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

export const [visStore, setVisStore] = createStore<VisualisationState>(initialState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Ingest a `useq-visualisation-changed` event detail from the legacy
 * visualisationController.  This converts the Map-based expressions into
 * a plain Record so Solid's store proxy can track individual keys.
 */
export function applyVisualisationEvent(detail: {
  kind?: string;
  currentTimeSeconds?: number;
  displayTimeSeconds?: number;
  settings?: Partial<VisSettings>;
  expressions?: Map<string, any>;
  bar?: number;
}) {
  const expressionsRecord: Record<string, VisExpression> = {};
  if (detail.expressions) {
    for (const [key, expr] of detail.expressions.entries()) {
      expressionsRecord[key] = {
        exprType: expr.exprType,
        expressionText: expr.expressionText ?? "",
        samples: Array.isArray(expr.samples) ? expr.samples : [],
        color: expr.color ?? null,
      };
    }
  }

  setVisStore("currentTime", detail.currentTimeSeconds ?? visStore.currentTime);
  setVisStore("displayTime", detail.displayTimeSeconds ?? visStore.displayTime);
  setVisStore("bar", detail.bar ?? visStore.bar);
  setVisStore("lastChangeKind", detail.kind ?? "");
  if (detail.settings) {
    setVisStore("settings", reconcile({ ...DEFAULT_SETTINGS, ...detail.settings }));
  }
  setVisStore("expressions", reconcile(expressionsRecord));
}

/**
 * Snapshot serial CircularBuffer instances into plain arrays for reactive
 * consumption.  Call this from the serial-data update path.
 *
 * @param buffers Array of CircularBuffer instances (legacy serialBuffers)
 */
export function snapshotSerialBuffers(buffers: Array<{ length: number; oldest(i: number): number; capacity: number }>) {
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
export function setVisPalette(palette: string[]) {
  setVisStore("palette", reconcile([...palette]));
}

// ---------------------------------------------------------------------------
// Window event bridge — connects legacy events to the Solid store
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.addEventListener("useq-visualisation-changed", ((event: CustomEvent) => {
    applyVisualisationEvent(event.detail);
  }) as EventListener);

  window.addEventListener("useq-serialvis-palette-changed", ((event: CustomEvent) => {
    if (Array.isArray(event.detail?.palette)) {
      setVisPalette(event.detail.palette);
    }
  }) as EventListener);
}
