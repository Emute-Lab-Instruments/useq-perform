import type { DecorationSet } from "@codemirror/view";

import type { ProbeMode } from "../probeHelpers.ts";

export const DEFAULT_PROBE_SAMPLE_COUNT = 40;
export const DEFAULT_PROBE_LINE_WIDTH = 2;
export const DEFAULT_PROBE_REFRESH_INTERVAL_MS = 33;
export const DEFAULT_PROBE_CANVAS_WIDTH = 138;
export const DEFAULT_PROBE_CANVAS_HEIGHT = 46;
export const DEFAULT_PROBE_WINDOW_DURATION_MS = 1000;
export const MIN_PROBE_WINDOW_DURATION_MS = 500;
export const MAX_PROBE_WINDOW_DURATION_MS = 5000;

export interface ProbeBatchResult {
  samples: number[];
  current: string;
}

export interface ProbeConfig {
  evalExpression: (code: string) => Promise<string | null>;
  evalExpressionAtTimes: (
    code: string,
    times: readonly number[],
  ) => Promise<ProbeBatchResult | null>;
  getRefreshIntervalMs: () => number;
  getLineWidth: () => number;
  getDefaultSamples: () => number;
  getCurrentTime: () => number;
  loadPersistedProbes: () => unknown[];
  savePersistedProbes: (data: PersistedProbeSpec[]) => void;
  removePersistedProbes: () => void;
  probeSet: (slot: number, code: string) => Promise<number>;
  probeSample: (
    slot: number,
    startTime: number,
    endTime: number,
    count: number,
  ) => Promise<Float64Array | null>;
  probeFree: (slot: number) => Promise<void>;
  isWasmEnabled: () => boolean;
}

export interface PersistedProbeSpec {
  id: string;
  from: number;
  to: number;
  mode: ProbeMode;
  depth: number;
  maxDepth: number;
  cachedCode: string;
  canvasWidth: number;
  canvasHeight: number;
  windowDurationMs: number;
}

export type ProbeRenderKind =
  | "loading"
  | "waveform"
  | "text"
  | "error"
  | "stale"
  | "disabled";

export type HighlightMode = "contextual" | "raw";

export interface ProbeRenderData {
  revision: number;
  kind: ProbeRenderKind;
  text: string;
  samples: number[];
  currentTime: number;
  windowStart: number;
  windowDuration: number;
  depth: number;
  maxDepth: number;
}

export interface FromListHighlight {
  from: number;
  to: number;
  mode: HighlightMode;
}

export interface ProbeFieldValue {
  probes: PersistedProbeSpec[];
  renderById: Record<string, ProbeRenderData>;
  highlights: FromListHighlight[];
  decorations: DecorationSet;
  staleIds: Set<string>;
}

export interface ProbeRenderUpdate {
  probe: PersistedProbeSpec;
  render: ProbeRenderData;
}
