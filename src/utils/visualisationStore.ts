import { createStore, reconcile } from "solid-js/store";
import {
  SERIAL_VIS_PALETTE_CHANGED_EVENT,
  VISUALISATION_SESSION_EVENT,
  addVisualisationEventListener,
  type VisualisationSessionDetail,
} from "../contracts/visualisationEvents";

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

/**
 * Named session type for the cross-layer visualisation payload.
 *
 * Components and adapters should reference VisualisationSession rather than
 * the internal VisualisationState alias so the type boundary is explicit.
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

export const [visStore, setVisStore] = createStore<VisualisationState>(initialState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Ingest a serializable visualisation session snapshot from the legacy
 * visualisation controller adapter.
 */
export function applyVisualisationEvent(detail: VisualisationSessionDetail) {
  const expressionsRecord: Record<string, VisExpression> = {};
  if (detail.expressions) {
    for (const [key, expr] of Object.entries(detail.expressions)) {
      expressionsRecord[key] = {
        exprType: expr?.exprType ?? key,
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
// Named adapter boundary — this is the single authorised place where the
// visualisation events are ingested into the typed Solid store here. All
// other modules must consume visualisation state through visStore, not by
// listening to the browser events directly.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  addVisualisationEventListener(VISUALISATION_SESSION_EVENT, (detail) => {
    applyVisualisationEvent(detail);
  });

  addVisualisationEventListener(SERIAL_VIS_PALETTE_CHANGED_EVENT, (detail) => {
    if (Array.isArray(detail?.palette)) {
      setVisPalette(detail.palette);
    }
  });
}
