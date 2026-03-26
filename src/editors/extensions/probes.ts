import {
  type Extension,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import {
  PERSISTENCE_KEYS,
  load,
  remove,
  save,
} from "../../lib/persistence.ts";
import { visStore } from "../../utils/visualisationStore.ts";
import {
  evalInUseqWasmSilently,
} from "../../runtime/wasmInterpreter.ts";
import { dbg } from "../../lib/debug.ts";
import {
  buildProbeExpression,
  collectTemporalWrappers,
  collectVisibleIndexedForms,
  computeFromListIndex,
  getCurrentProbeRange,
  type IndexedFormTarget,
  type ProbeMode,
  type ProbeRange,
} from "./probeHelpers.ts";

// ---------------------------------------------------------------------------
// ProbeConfig — dependency injection interface
// ---------------------------------------------------------------------------

/**
 * Configuration for the probe system.
 * Each field is a specific capability the probes need — no app-wide settings objects.
 */
export interface ProbeConfig {
  /** Evaluate a code expression silently via the WASM interpreter and return the result string (or null on error) */
  evalExpression: (code: string) => Promise<string | null>;
  /** Get the probe refresh interval in ms */
  getRefreshIntervalMs: () => number;
  /** Get the probe line width for canvas rendering */
  getLineWidth: () => number;
  /** Get the default number of samples to display */
  getDefaultSamples: () => number;
  /** Get the current time value for temporal probes */
  getCurrentTime: () => number;
  /** Load persisted probe state */
  loadPersistedProbes: () => unknown[];
  /** Save probe state for persistence */
  savePersistedProbes: (data: PersistedProbeSpec[]) => void;
  /** Remove persisted probe state (when empty) */
  removePersistedProbes: () => void;
}

/** Create a ProbeConfig that delegates to the existing singletons. */
export function createDefaultProbeConfig(): ProbeConfig {
  return {
    evalExpression: (code: string) => evalInUseqWasmSilently(code),
    getRefreshIntervalMs: () => {
      const raw = Number(visStore.settings.probeRefreshIntervalMs);
      if (!Number.isFinite(raw)) return DEFAULT_PROBE_REFRESH_INTERVAL_MS;
      return Math.max(16, raw);
    },
    getLineWidth: () => visStore.settings.probeLineWidth || DEFAULT_PROBE_LINE_WIDTH,
    getDefaultSamples: () => visStore.settings.probeSampleCount || DEFAULT_PROBE_SAMPLE_COUNT,
    getCurrentTime: () => visStore.currentTime,
    loadPersistedProbes: () => {
      const loaded = load<unknown[]>(PERSISTENCE_KEYS.editorProbes, []);
      return Array.isArray(loaded) ? loaded : [];
    },
    savePersistedProbes: (data: PersistedProbeSpec[]) => {
      save(PERSISTENCE_KEYS.editorProbes, data);
    },
    removePersistedProbes: () => {
      remove(PERSISTENCE_KEYS.editorProbes);
    },
  };
}

const DEFAULT_PROBE_SAMPLE_COUNT = 40;
const DEFAULT_PROBE_LINE_WIDTH = 2;
const DEFAULT_PROBE_REFRESH_INTERVAL_MS = 33;
const PROBE_ACCENT_REFRESH_INTERVAL_MS = 250;
const DEFAULT_BAR_DURATION_SECONDS = 1;
const ERROR_PREFIX = "Error:";

// Module-level config reference, set by createProbeExtensions.
let _config: ProbeConfig = createDefaultProbeConfig();
const DEFAULT_PROBE_CANVAS_WIDTH = 138;
const DEFAULT_PROBE_CANVAS_HEIGHT = 46;
const DEFAULT_PROBE_WINDOW_DURATION_MS = 1000;
const MIN_PROBE_WINDOW_DURATION_MS = 500;
const MAX_PROBE_WINDOW_DURATION_MS = 5000;

let cachedAccentColor: string | null = null;
let lastAccentColorRead = 0;

// Placement choice for v1: inline widget immediately after the probed form.
// Follow-up options worth testing are block widgets under the form and an
// absolutely positioned floating overlay anchored from editor coordinates.

type ProbeRenderKind = "loading" | "waveform" | "text" | "error";
type HighlightMode = "contextual" | "raw";

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

interface ProbeRenderData {
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

function readAccentColor(): string {
  const computed = getComputedStyle(document.documentElement).getPropertyValue(
    "--accent-color",
  );
  return (computed && computed.trim()) || "#00ff41";
}

function getAccentColor(): string {
  const now = window.performance?.now?.() ?? Date.now();
  if (
    cachedAccentColor !== null &&
    now - lastAccentColorRead <= PROBE_ACCENT_REFRESH_INTERVAL_MS
  ) {
    return cachedAccentColor;
  }

  cachedAccentColor = readAccentColor();
  lastAccentColorRead = now;
  return cachedAccentColor;
}

function getProbeRefreshIntervalMs(): number {
  return _config.getRefreshIntervalMs();
}

interface FromListHighlight {
  from: number;
  to: number;
  mode: HighlightMode;
}

interface ProbeFieldValue {
  probes: PersistedProbeSpec[];
  renderById: Record<string, ProbeRenderData>;
  highlights: FromListHighlight[];
  decorations: DecorationSet;
}

interface ProbeRenderUpdate {
  probe: PersistedProbeSpec;
  render: ProbeRenderData;
}

const toggleProbeEffect = StateEffect.define<PersistedProbeSpec>();
const removeProbeEffect = StateEffect.define<{ id: string }>();
const setProbeDepthEffect = StateEffect.define<{ id: string; delta: number }>();
const setProbeCanvasSizeEffect = StateEffect.define<{ id: string; width: number; height: number }>();
const setProbeWindowDurationEffect = StateEffect.define<{ id: string; durationMs: number }>();
const updateProbeRenderEffect = StateEffect.define<{
  updates: ProbeRenderUpdate[];
  highlights: FromListHighlight[];
}>();

function isPersistedProbeSpec(value: unknown): value is PersistedProbeSpec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.from === "number" &&
    typeof candidate.to === "number" &&
    (candidate.mode === "raw" || candidate.mode === "contextual") &&
    typeof candidate.depth === "number" &&
    typeof candidate.maxDepth === "number" &&
    typeof candidate.cachedCode === "string"
  );
}

function readPersistedProbes(): PersistedProbeSpec[] {
  const loaded = _config.loadPersistedProbes();
  if (!Array.isArray(loaded)) return [];
  return loaded.filter(isPersistedProbeSpec).map((probe) => ({
    ...probe,
    depth: Math.max(0, Math.floor(probe.depth)),
    maxDepth: Math.max(0, Math.floor(probe.maxDepth)),
    canvasWidth: Number.isFinite(probe.canvasWidth) && probe.canvasWidth > 0
      ? probe.canvasWidth
      : DEFAULT_PROBE_CANVAS_WIDTH,
    canvasHeight: Number.isFinite(probe.canvasHeight) && probe.canvasHeight > 0
      ? probe.canvasHeight
      : DEFAULT_PROBE_CANVAS_HEIGHT,
    windowDurationMs: Number.isFinite(probe.windowDurationMs) && probe.windowDurationMs >= MIN_PROBE_WINDOW_DURATION_MS && probe.windowDurationMs <= MAX_PROBE_WINDOW_DURATION_MS
      ? probe.windowDurationMs
      : DEFAULT_PROBE_WINDOW_DURATION_MS,
  }));
}

function persistProbes(probes: PersistedProbeSpec[]): void {
  if (probes.length === 0) {
    _config.removePersistedProbes();
    return;
  }
  _config.savePersistedProbes(probes);
}

function intersectsViewport(
  range: ProbeRange,
  visibleRanges: readonly ProbeRange[],
): boolean {
  return visibleRanges.some(
    (visible) => range.from < visible.to && range.to > visible.from,
  );
}

function createProbeId(range: ProbeRange, mode: ProbeMode): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${mode}:${range.from}:${range.to}:${random}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  render: ProbeRenderData,
  lineWidth: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(13, 18, 24, 0.94)";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  const finiteSamples = render.samples.filter(Number.isFinite);
  if (finiteSamples.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "10px monospace";
    ctx.fillText("no numeric output", 8, height / 2 + 3);
    return;
  }

  // Use [0, 1] as the baseline range so phasor-like signals render at
  // their true scale.  Expand only when samples exceed that range.
  let min = 0;
  let max = 1;
  for (const value of finiteSamples) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (Math.abs(max - min) < 1e-9) {
    max = min + 1;
  }

  ctx.strokeStyle = getAccentColor();
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  render.samples.forEach((value, index) => {
    const x = render.samples.length > 1
      ? (index / (render.samples.length - 1)) * width
      : width;
    const y = Number.isFinite(value)
      ? height - ((value - min) / (max - min)) * height
      : height / 2;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

interface ProbeDOMElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement | null;
  textEl: HTMLElement | null;
  depthLabel: HTMLElement;
  leftCaret: HTMLButtonElement | null;
  rightCaret: HTMLButtonElement | null;
  windowDurationSlider: HTMLInputElement | null;
  windowDurationValue: HTMLElement | null;
}

const probeDOMRegistry: Map<string, ProbeDOMElements> = new Map();

function getProbeDOM(id: string): ProbeDOMElements | undefined {
  return probeDOMRegistry.get(id);
}

function updateProbeDOM(
  id: string,
  probe: PersistedProbeSpec,
  render: ProbeRenderData | null,
): void {
  const elements = probeDOMRegistry.get(id);
  if (!elements) return;

  elements.depthLabel.textContent = probe.mode === "raw"
    ? "raw"
    : `${probe.depth}/${probe.maxDepth}`;

  if (elements.leftCaret) {
    elements.leftCaret.disabled = probe.depth <= 0;
  }
  if (elements.rightCaret) {
    elements.rightCaret.disabled = probe.depth >= probe.maxDepth;
  }

  if (elements.windowDurationSlider) {
    elements.windowDurationSlider.value = String(probe.windowDurationMs);
  }
  if (elements.windowDurationValue) {
    elements.windowDurationValue.textContent = `${probe.windowDurationMs}ms`;
  }

  if (!render || render.kind === "loading") {
    if (elements.canvas) {
      elements.canvas.remove();
      elements.canvas = null;
    }
    if (!elements.textEl) {
      const text = document.createElement("span");
      text.className = "cm-probe-widget-text";
      text.textContent = "sampling...";
      elements.root.querySelector(".cm-probe-widget-body")?.prepend(text);
      elements.textEl = text;
    } else {
      elements.textEl.textContent = "sampling...";
      elements.textEl.className = "cm-probe-widget-text";
    }
  } else if (render.kind === "waveform") {
    if (elements.textEl) {
      elements.textEl.remove();
      elements.textEl = null;
    }
    if (!elements.canvas) {
      const canvas = document.createElement("canvas");
      elements.root.querySelector(".cm-probe-widget-body")?.prepend(canvas);
      elements.canvas = canvas;
    }
    const canvas = elements.canvas;
    if (canvas.width !== probe.canvasWidth || canvas.height !== probe.canvasHeight) {
      canvas.width = probe.canvasWidth;
      canvas.height = probe.canvasHeight;
    }
    drawWaveform(canvas, render, _config.getLineWidth());
  } else {
    if (elements.canvas) {
      elements.canvas.remove();
      elements.canvas = null;
    }
    if (!elements.textEl) {
      const text = document.createElement("span");
      elements.root.querySelector(".cm-probe-widget-body")?.prepend(text);
      elements.textEl = text;
    }
    elements.textEl.className = `cm-probe-widget-text is-${render.kind}`;
    elements.textEl.innerHTML = escapeHtml(render.text);
  }
}

class ProbeWidget extends WidgetType {
  constructor(
    private readonly probe: PersistedProbeSpec,
    private readonly render: ProbeRenderData | null,
  ) {
    super();
  }

  eq(other: ProbeWidget): boolean {
    return this.probe.id === other.probe.id;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-probe-widget";
    root.dataset.probeId = this.probe.id;
    root.style.width = `${this.probe.canvasWidth + 4}px`;
    root.style.height = `${this.probe.canvasHeight + 18}px`;

    const body = document.createElement("span");
    body.className = "cm-probe-widget-body";

    let canvas: HTMLCanvasElement | null = null;
    let textEl: HTMLElement | null = null;

    const render = this.render;
    if (!render || render.kind === "loading") {
      textEl = document.createElement("span");
      textEl.className = "cm-probe-widget-text";
      textEl.textContent = "sampling...";
      body.appendChild(textEl);
    } else if (render.kind === "waveform") {
      canvas = document.createElement("canvas");
      canvas.width = this.probe.canvasWidth;
      canvas.height = this.probe.canvasHeight;
      drawWaveform(canvas, render, _config.getLineWidth());
      body.appendChild(canvas);
    } else {
      textEl = document.createElement("span");
      textEl.className = `cm-probe-widget-text is-${render.kind}`;
      textEl.innerHTML = escapeHtml(render.text);
      body.appendChild(textEl);
    }

    const depthOverlay = document.createElement("span");
    depthOverlay.className = "cm-probe-depth-overlay";

    const depthLabel = document.createElement("span");
    depthLabel.className = "cm-probe-depth-label";
    depthLabel.textContent = this.probe.mode === "raw"
      ? "raw"
      : `${this.probe.depth}/${this.probe.maxDepth}`;
    depthOverlay.appendChild(depthLabel);

    let leftCaret: HTMLButtonElement | null = null;
    let rightCaret: HTMLButtonElement | null = null;

    if (this.probe.mode === "contextual" && this.probe.maxDepth > 0) {
      leftCaret = document.createElement("button");
      leftCaret.type = "button";
      leftCaret.className = "cm-probe-caret-btn";
      leftCaret.dataset.probeId = this.probe.id;
      leftCaret.dataset.delta = "-1";
      leftCaret.title = "Decrease context depth";
      leftCaret.setAttribute("aria-label", "Decrease context depth");
      leftCaret.textContent = "‹";
      if (this.probe.depth <= 0) {
        leftCaret.disabled = true;
      }
      depthOverlay.appendChild(leftCaret);

      rightCaret = document.createElement("button");
      rightCaret.type = "button";
      rightCaret.className = "cm-probe-caret-btn";
      rightCaret.dataset.probeId = this.probe.id;
      rightCaret.dataset.delta = "1";
      rightCaret.title = "Increase context depth";
      rightCaret.setAttribute("aria-label", "Increase context depth");
      rightCaret.textContent = "›";
      if (this.probe.depth >= this.probe.maxDepth) {
        rightCaret.disabled = true;
      }
      depthOverlay.appendChild(rightCaret);
    }

    body.appendChild(depthOverlay);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cm-probe-close-btn";
    close.dataset.probeId = this.probe.id;
    close.title = "Remove probe";
    close.setAttribute("aria-label", "Remove probe");
    close.textContent = "×";
    body.appendChild(close);

    const windowDurationContainer = document.createElement("span");
    windowDurationContainer.className = "cm-probe-window-duration";

    const windowDurationSlider = document.createElement("input");
    windowDurationSlider.type = "range";
    windowDurationSlider.className = "cm-probe-window-duration-slider";
    windowDurationSlider.min = String(MIN_PROBE_WINDOW_DURATION_MS);
    windowDurationSlider.max = String(MAX_PROBE_WINDOW_DURATION_MS);
    windowDurationSlider.step = "100";
    windowDurationSlider.value = String(this.probe.windowDurationMs);
    windowDurationSlider.dataset.probeId = this.probe.id;
    windowDurationSlider.title = "Oscilloscope window width (ms)";
    windowDurationSlider.setAttribute("aria-label", "Oscilloscope window width in milliseconds");
    windowDurationContainer.appendChild(windowDurationSlider);

    const windowDurationValue = document.createElement("span");
    windowDurationValue.className = "cm-probe-window-duration-value";
    windowDurationValue.textContent = `${this.probe.windowDurationMs}ms`;
    windowDurationContainer.appendChild(windowDurationValue);

    body.appendChild(windowDurationContainer);

    root.appendChild(body);

    probeDOMRegistry.set(this.probe.id, {
      root,
      canvas,
      textEl,
      depthLabel,
      leftCaret,
      rightCaret,
      windowDurationSlider,
      windowDurationValue,
    });

    return root;
  }

  destroy(dom: HTMLElement): void {
    const id = dom.dataset.probeId;
    if (id) {
      probeDOMRegistry.delete(id);
    }
  }
}

function buildDecorations(snapshot: ProbeFieldValue): DecorationSet {
  const decorations = [];

  for (const highlight of snapshot.highlights) {
    const className = highlight.mode === "raw"
      ? "cm-probe-indexed-item cm-probe-indexed-item-raw"
      : "cm-probe-indexed-item cm-probe-indexed-item-contextual";
    decorations.push(
      Decoration.mark({ class: className }).range(
        highlight.from,
        highlight.to,
      ),
    );
  }

  for (const probe of snapshot.probes) {
    decorations.push(
      Decoration.widget({
        widget: new ProbeWidget(probe, snapshot.renderById[probe.id] ?? null),
        side: 1,
      }).range(probe.to),
    );
  }

  return decorations.length > 0
    ? Decoration.set(decorations, true)
    : Decoration.none;
}

function buildSnapshot(
  probes: PersistedProbeSpec[],
  renderById: Record<string, ProbeRenderData>,
  highlights: FromListHighlight[],
): ProbeFieldValue {
  const snapshot: ProbeFieldValue = {
    probes,
    renderById,
    highlights,
    decorations: Decoration.none,
  };
  snapshot.decorations = buildDecorations(snapshot);
  return snapshot;
}

function updateProbeRangeThroughChanges(
  probe: PersistedProbeSpec,
  state: EditorState,
): PersistedProbeSpec {
  const rebuilt = buildProbeExpression(state, { from: probe.from, to: probe.to }, probe.mode, probe.depth);
  if (!rebuilt) {
    return probe;
  }
  return {
    ...probe,
    maxDepth: rebuilt.maxDepth,
    depth: probe.mode === "raw" ? 0 : Math.min(probe.depth, rebuilt.maxDepth),
  };
}

function updateProbeRender(
  existing: ProbeRenderData | undefined,
  next: Omit<ProbeRenderData, "revision">,
): ProbeRenderData {
  if (
    existing &&
    existing.kind === next.kind &&
    existing.text === next.text &&
    existing.currentTime === next.currentTime &&
    existing.windowStart === next.windowStart &&
    existing.windowDuration === next.windowDuration &&
    existing.depth === next.depth &&
    existing.maxDepth === next.maxDepth &&
    existing.samples.length === next.samples.length &&
    existing.samples.every((v, i) => v === next.samples[i])
  ) {
    return existing;
  }
  return {
    ...next,
    revision: (existing?.revision ?? 0) + 1,
  };
}

const probeField = StateField.define<ProbeFieldValue>({
  create(state) {
    // Filter out persisted probes whose positions exceed this document's length.
    // This prevents crashes when the extension is used in a smaller editor instance
    // (e.g., guide playgrounds) that shares localStorage with the main editor.
    const docLen = state.doc.length;
    const probes = readPersistedProbes().filter(
      (p) => p.from <= docLen && p.to <= docLen
    );
    return buildSnapshot(probes, {}, []);
  },

  update(value, tr) {
    let probes = value.probes;
    let renderById = value.renderById;
    let highlights = value.highlights;

    if (tr.docChanged) {
      const docLen = tr.state.doc.length;
      probes = probes
        .filter((p) => p.from <= docLen && p.to <= docLen)
        .map((probe) => {
        const mappedFrom = tr.changes.mapPos(probe.from, 1);
        const mappedTo = tr.changes.mapPos(probe.to, -1);
        return updateProbeRangeThroughChanges(
          {
            ...probe,
            from: Math.max(0, Math.min(mappedFrom, mappedTo)),
            to: Math.max(mappedFrom, mappedTo),
          },
          tr.state,
        );
      });
      highlights = [];
    }

    for (const effect of tr.effects) {
      if (effect.is(toggleProbeEffect)) {
        const probe = effect.value;
        const existing = probes.findIndex(
          (entry) =>
            entry.mode === probe.mode &&
            entry.from === probe.from &&
            entry.to === probe.to,
        );
        if (existing >= 0) {
          const removed = probes[existing];
          probes = probes.filter((_, index) => index !== existing);
          const { [removed.id]: _, ...rest } = renderById;
          renderById = rest;
        } else {
          probes = [...probes, probe];
        }
      } else if (effect.is(removeProbeEffect)) {
        const { id } = effect.value;
        probes = probes.filter((probe) => probe.id !== id);
        const { [id]: _, ...rest } = renderById;
        renderById = rest;
      } else if (effect.is(setProbeDepthEffect)) {
        const { id, delta } = effect.value;
        probes = probes.map((probe) => {
          if (probe.id !== id || probe.mode !== "contextual") return probe;
          const nextDepth = Math.max(0, Math.min(probe.maxDepth, probe.depth + delta));
          return nextDepth === probe.depth ? probe : { ...probe, depth: nextDepth };
        });
      } else if (effect.is(setProbeCanvasSizeEffect)) {
        const { id, width, height } = effect.value;
        probes = probes.map((probe) => {
          if (probe.id !== id) return probe;
          return { ...probe, canvasWidth: width, canvasHeight: height };
        });
      } else if (effect.is(setProbeWindowDurationEffect)) {
        const { id, durationMs } = effect.value;
        const clampedDuration = Math.max(MIN_PROBE_WINDOW_DURATION_MS, Math.min(MAX_PROBE_WINDOW_DURATION_MS, durationMs));
        probes = probes.map((probe) => {
          if (probe.id !== id) return probe;
          return { ...probe, windowDurationMs: clampedDuration };
        });
      } else if (effect.is(updateProbeRenderEffect)) {
        const nextRenderById = { ...renderById };
        let nextProbes = probes;
        for (const update of effect.value.updates) {
          nextRenderById[update.probe.id] = update.render;
          nextProbes = nextProbes.map((probe) =>
            probe.id === update.probe.id ? update.probe : probe,
          );
        }
        renderById = nextRenderById;
        probes = nextProbes;
        highlights = effect.value.highlights;
      }
    }

    return buildSnapshot(probes, renderById, highlights);
  },

  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

async function evaluateProbeCode(code: string): Promise<string> {
  const result = await _config.evalExpression(code);
  return typeof result === "string" ? result.trim() : String(result ?? "").trim();
}

function isErrorResult(text: string): boolean {
  return text.startsWith(ERROR_PREFIX);
}

async function readBarDurationSeconds(): Promise<number> {
  try {
    const result = await evaluateProbeCode("barDur");
    const numeric = Number(result);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  } catch (error) {
    dbg(`probe: failed to read barDur (${error})`);
  }
  return DEFAULT_BAR_DURATION_SECONDS;
}

function formatOffset(offsetSeconds: number): string {
  if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) < 1e-9) {
    return "0";
  }
  return offsetSeconds.toFixed(6).replace(/\.?0+$/, "");
}

function withOffset(code: string, offsetSeconds: number): string {
  if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) < 1e-9) {
    return code;
  }
  return `(offset ${formatOffset(offsetSeconds)} ${code})`;
}

async function sampleWaveform(
  code: string,
  currentTime: number,
  windowDuration: number,
  sampleCount: number,
): Promise<{ current: string; samples: number[] }> {
  const samples: number[] = [];
  const startTime = currentTime - windowDuration;
  const count = Math.max(2, Math.floor(sampleCount) || DEFAULT_PROBE_SAMPLE_COUNT);
  const step = count > 1
    ? windowDuration / (count - 1)
    : windowDuration;

  let currentResult = "";
  for (let index = 0; index < count; index++) {
    const sampleTime = startTime + step * index;
    const result = await evaluateProbeCode(
      withOffset(code, sampleTime - currentTime),
    );
    if (index === count - 1) {
      currentResult = result;
    }
    const numeric = Number(result);
    if (!Number.isFinite(numeric)) {
      return { current: currentResult || result, samples: [] };
    }
    samples.push(numeric);
  }

  return { current: currentResult, samples };
}

async function buildRenderForProbe(
  state: EditorState,
  probe: PersistedProbeSpec,
  currentTime: number,
  settings: { probeSampleCount: number },
): Promise<ProbeRenderUpdate | null> {
  const built = buildProbeExpression(
    state,
    { from: probe.from, to: probe.to },
    probe.mode,
    probe.mode === "raw" ? 0 : probe.depth,
  );

  const liveCode = built?.code?.trim() ?? "";
  const maxDepth = built?.maxDepth ?? probe.maxDepth;
  const depth = probe.mode === "raw" ? 0 : Math.min(probe.depth, maxDepth);
  const temporalScale = built?.temporalScale ?? 1;
  const windowDurationSeconds = (probe.windowDurationMs / 1000) * temporalScale;
  const candidateCode = liveCode || probe.cachedCode;
  const sampleCount = settings.probeSampleCount || DEFAULT_PROBE_SAMPLE_COUNT;

  if (!candidateCode) {
    return {
      probe: { ...probe, maxDepth, depth },
      render: {
        revision: 0,
        kind: "loading",
        text: "sampling...",
        samples: [],
        currentTime,
        windowStart: currentTime - windowDurationSeconds,
        windowDuration: windowDurationSeconds,
        depth,
        maxDepth,
      },
    };
  }

  const attempts = [candidateCode];
  if (probe.cachedCode && probe.cachedCode !== candidateCode) {
    attempts.push(probe.cachedCode);
  }

  for (const code of attempts) {
    try {
      const sample = await sampleWaveform(
        code,
        currentTime,
        windowDurationSeconds,
        sampleCount,
      );
      if (sample.samples.length === 0) {
        return {
          probe: {
            ...probe,
            cachedCode: code,
            maxDepth,
            depth,
          },
          render: {
            revision: 0,
            kind: isErrorResult(sample.current) ? "error" : "text",
            text: sample.current || "nil",
            samples: [],
            currentTime,
            windowStart: currentTime - windowDurationSeconds,
            windowDuration: windowDurationSeconds,
            depth,
            maxDepth,
          },
        };
      }

      return {
        probe: {
          ...probe,
          cachedCode: code,
          maxDepth,
          depth,
        },
        render: {
          revision: 0,
          kind: "waveform",
          text: sample.current,
          samples: sample.samples,
          currentTime,
          windowStart: currentTime - windowDurationSeconds,
          windowDuration: windowDurationSeconds,
          depth,
          maxDepth,
        },
      };
    } catch (error) {
      dbg(`probe: sample failed for ${probe.id} (${error})`);
    }
  }

  return {
    probe: {
      ...probe,
      maxDepth,
      depth,
    },
    render: {
      revision: 0,
      kind: "error",
      text: probe.cachedCode ? "using last valid expression" : "probe unavailable",
      samples: [],
      currentTime,
      windowStart: currentTime - windowDurationSeconds,
      windowDuration: windowDurationSeconds,
      depth,
      maxDepth,
    },
  };
}

async function computeHighlights(
  state: EditorState,
  forms: IndexedFormTarget[],
  probes: PersistedProbeSpec[],
): Promise<FromListHighlight[]> {
  const highlights: FromListHighlight[] = [];

  for (const form of forms) {
    const contextual = buildProbeExpression(state, form.phasorRange, "contextual");
    if (contextual?.code) {
      try {
        const result = await evaluateProbeCode(contextual.code);
        if (!isErrorResult(result)) {
          const index = computeFromListIndex(
            form.elementRanges.length,
            Number(result),
          );
          const active = index == null ? null : form.elementRanges[index];
          if (active) {
            highlights.push({
              from: active.from,
              to: active.to,
              mode: "contextual",
            });
          }
        }
      } catch (error) {
        dbg(`probe: failed to highlight indexed form (${error})`);
      }
    }

    const formCode = state.sliceDoc(form.formRange.from, form.formRange.to).trim();
    const rawFormProbe = probes.some((probe) => {
      if (probe.mode !== "raw") return false;
      if (probe.to <= form.formRange.from || probe.from >= form.formRange.to) {
        return false;
      }

      const built = buildProbeExpression(
        state,
        { from: probe.from, to: probe.to },
        "raw",
      );

      return built?.code.trim() === formCode;
    });

    if (!rawFormProbe) {
      continue;
    }

    const raw = buildProbeExpression(state, form.phasorRange, "raw");
    if (!raw?.code) continue;

    try {
      const result = await evaluateProbeCode(raw.code);
      if (isErrorResult(result)) continue;
      const index = computeFromListIndex(
        form.elementRanges.length,
        Number(result),
      );
      const active = index == null ? null : form.elementRanges[index];
      if (!active) continue;
      highlights.push({
        from: active.from,
        to: active.to,
        mode: "raw",
      });
    } catch (error) {
      dbg(`probe: failed to compute raw indexed highlight (${error})`);
    }
  }

  return highlights;
}

class ProbePlugin {
  private frameId: number | null = null;
  private lastRun = 0;
  private samplingInFlight = false;
  private visibleForms: IndexedFormTarget[] = [];
  private previousProbeSignature = "";
  private resizeObserver: ResizeObserver;
  private resizeTimers: Map<string, number> = new Map();
  private contextLineCanvas: HTMLCanvasElement | null = null;
  private onScroll: () => void;
  private onWindowResize: () => void;

  constructor(private readonly view: EditorView) {
    this.previousProbeSignature = JSON.stringify(
      view.state.field(probeField).probes,
    );
    this.recomputeVisibleForms(view);
    this.onClick = this.onClick.bind(this);
    this.onWindowDurationInput = this.onWindowDurationInput.bind(this);
    this.onResize = this.onResize.bind(this);
    this.tick = this.tick.bind(this);
    this.onScroll = () => this.drawContextLines();
    this.onWindowResize = () => this.drawContextLines();
    this.view.dom.addEventListener("click", this.onClick);
    this.view.dom.addEventListener("input", this.onWindowDurationInput);
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.observeProbeWidgets();
    this.initContextLineCanvas();
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.recomputeVisibleForms(update.view);
      this.observeProbeWidgets();
    }

    const probes = update.state.field(probeField).probes;
    const nextSignature = JSON.stringify(probes);
    if (nextSignature !== this.previousProbeSignature) {
      this.previousProbeSignature = nextSignature;
      persistProbes(probes);
    }

    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.drawContextLines();
    }
  }

  destroy(): void {
    if (this.frameId != null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.resizeObserver.disconnect();
    this.resizeTimers.clear();
    this.view.dom.removeEventListener("click", this.onClick);
    this.view.dom.removeEventListener("input", this.onWindowDurationInput);
    this.destroyContextLineCanvas();
  }

  private initContextLineCanvas(): void {
    const scroller = this.view.scrollDOM;
    const canvas = document.createElement("canvas");
    canvas.className = "cm-probe-context-lines";
    scroller.appendChild(canvas);
    this.contextLineCanvas = canvas;
    scroller.addEventListener("scroll", this.onScroll);
    window.addEventListener("resize", this.onWindowResize);
  }

  private destroyContextLineCanvas(): void {
    if (this.contextLineCanvas) {
      this.contextLineCanvas.remove();
      this.contextLineCanvas = null;
    }
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize);
  }

  private drawContextLines(): void {
    const canvas = this.contextLineCanvas;
    if (!canvas) return;

    const scroller = this.view.scrollDOM;
    const scrollerRect = scroller.getBoundingClientRect();

    // Size the canvas to cover the full scrollable content area
    const contentWidth = scroller.scrollWidth;
    const contentHeight = scroller.scrollHeight;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== contentWidth * dpr || canvas.height !== contentHeight * dpr) {
      canvas.width = contentWidth * dpr;
      canvas.height = contentHeight * dpr;
      canvas.style.width = `${contentWidth}px`;
      canvas.style.height = `${contentHeight}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, contentWidth, contentHeight);

    const snapshot = this.view.state.field(probeField);
    const accentColor = getAccentColor();

    for (const probe of snapshot.probes) {
      if (probe.mode !== "contextual" || probe.depth <= 0) continue;

      const wrappers = collectTemporalWrappers(
        this.view.state,
        { from: probe.from, to: probe.to },
      );
      if (wrappers.length === 0) continue;

      const targetWrapper = wrappers[probe.depth - 1];
      if (!targetWrapper) continue;

      // Get wrapper function name position in viewport coordinates
      const nameCoords = this.view.coordsAtPos(targetWrapper.nameFrom);
      const nameEndCoords = this.view.coordsAtPos(targetWrapper.nameTo);
      if (!nameCoords || !nameEndCoords) continue;

      // Get probe widget DOM element position
      const elements = getProbeDOM(probe.id);
      if (!elements) continue;
      const widgetRect = elements.root.getBoundingClientRect();
      if (widgetRect.width === 0 && widgetRect.height === 0) continue;

      // Convert screen coords to content-relative coords (accounting for scroll)
      const scrollLeft = scroller.scrollLeft;
      const scrollTop = scroller.scrollTop;

      const nameCenterX = ((nameCoords.left + nameEndCoords.right) / 2) - scrollerRect.left + scrollLeft;
      const nameCenterY = ((nameCoords.top + nameCoords.bottom) / 2) - scrollerRect.top + scrollTop;

      const widgetCenterX = ((widgetRect.left + widgetRect.right) / 2) - scrollerRect.left + scrollLeft;
      const widgetTopY = widgetRect.top - scrollerRect.top + scrollTop;

      ctx.save();
      ctx.strokeStyle = accentColor;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(nameCenterX, nameCenterY);
      ctx.lineTo(widgetCenterX, widgetTopY);
      ctx.stroke();

      // Small dot at the wrapper name end
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([]);
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(nameCenterX, nameCenterY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private observeProbeWidgets(): void {
    this.resizeObserver.disconnect();
    const widgets = this.view.dom.querySelectorAll(".cm-probe-widget");
    for (const widget of widgets) {
      if (widget instanceof HTMLElement) {
        this.resizeObserver.observe(widget);
      }
    }
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const widget = entry.target;
      if (!(widget instanceof HTMLElement)) continue;
      const id = widget.dataset.probeId;
      if (!id) continue;

      const width = Math.round(entry.contentRect.width - 4);
      const height = Math.round(entry.contentRect.height - 18);
      if (width < 40 || height < 30) continue;

      const existingTimer = this.resizeTimers.get(id);
      if (existingTimer != null) {
        window.clearTimeout(existingTimer);
      }

      this.resizeTimers.set(id, window.setTimeout(() => {
        this.resizeTimers.delete(id);
        this.view.dispatch({
          effects: setProbeCanvasSizeEffect.of({ id, width, height }),
        });
      }, 150));
    }
  }

  private recomputeVisibleForms(view: EditorView): void {
    this.visibleForms = collectVisibleIndexedForms(
      view.state,
      view.visibleRanges.map((range) => ({ from: range.from, to: range.to })),
    );
  }

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const closeButton = target.closest(".cm-probe-close-btn");
    if (closeButton) {
      const id = closeButton.getAttribute("data-probe-id");
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      this.view.dispatch({ effects: removeProbeEffect.of({ id }) });
      return;
    }

    const caretButton = target.closest(".cm-probe-caret-btn");
    if (caretButton instanceof HTMLElement) {
      const id = caretButton.getAttribute("data-probe-id");
      const deltaStr = caretButton.getAttribute("data-delta");
      if (!id || !deltaStr) return;
      const delta = Number(deltaStr);
      if (!Number.isFinite(delta) || delta === 0) return;
      event.preventDefault();
      event.stopPropagation();

      const probes = this.view.state.field(probeField).probes;
      const probe = probes.find(p => p.id === id);
      if (probe) {
        const nextDepth = Math.max(0, Math.min(probe.maxDepth, probe.depth + delta));
        const elements = getProbeDOM(id);
        if (elements) {
          elements.depthLabel.textContent = `${nextDepth}/${probe.maxDepth}`;
          if (elements.leftCaret) elements.leftCaret.disabled = nextDepth <= 0;
          if (elements.rightCaret) elements.rightCaret.disabled = nextDepth >= probe.maxDepth;
        }
      }

      this.view.dispatch({ effects: setProbeDepthEffect.of({ id, delta }) });
    }
  }

  private onWindowDurationInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("cm-probe-window-duration-slider")) return;

    const id = target.dataset.probeId;
    if (!id) return;

    const value = Number(target.value);
    if (!Number.isFinite(value)) return;

    const elements = getProbeDOM(id);
    if (elements?.windowDurationValue) {
      elements.windowDurationValue.textContent = `${value}ms`;
    }

    this.view.dispatch({
      effects: setProbeWindowDurationEffect.of({ id, durationMs: value }),
    });
  }

  private async tick(now: number): Promise<void> {
    this.frameId = window.requestAnimationFrame(this.tick);
    if (this.samplingInFlight) return;
    if (now - this.lastRun < getProbeRefreshIntervalMs()) return;
    this.lastRun = now;

    const snapshot = this.view.state.field(probeField);
    const visibleRanges = this.view.visibleRanges.map((range) => ({
      from: range.from,
      to: range.to,
    }));
    const visibleProbes = snapshot.probes.filter((probe) =>
      intersectsViewport({ from: probe.from, to: probe.to }, visibleRanges),
    );

    if (visibleProbes.length === 0 && this.visibleForms.length === 0) {
      if (snapshot.highlights.length > 0) {
        this.view.dispatch({
          effects: updateProbeRenderEffect.of({ updates: [], highlights: [] }),
        });
      }
      return;
    }

    this.samplingInFlight = true;
    try {
      const currentTime = _config.getCurrentTime();
      const updates: ProbeRenderUpdate[] = [];

      for (const probe of visibleProbes) {
        const next = await buildRenderForProbe(
          this.view.state,
          probe,
          currentTime,
          {
            probeSampleCount: _config.getDefaultSamples(),
          },
        );
        if (!next) continue;

        updateProbeDOM(next.probe.id, next.probe, next.render);

        const existing = snapshot.renderById[next.probe.id];
        updates.push({
          probe: next.probe,
          render: updateProbeRender(existing, next.render),
        });
      }

      const highlights = await computeHighlights(
        this.view.state,
        this.visibleForms,
        snapshot.probes,
      );

      this.view.dispatch({
        effects: updateProbeRenderEffect.of({ updates, highlights }),
      });

      this.drawContextLines();
    } catch (error) {
      dbg(`probe: sampling tick failed (${error})`);
    } finally {
      this.samplingInFlight = false;
    }
  }
}

const probeViewPlugin = ViewPlugin.fromClass(ProbePlugin);

function buildProbeSpec(
  state: EditorState,
  range: ProbeRange,
  mode: ProbeMode,
): PersistedProbeSpec | null {
  const built = buildProbeExpression(state, range, mode);
  if (!built?.code) return null;
  return {
    id: createProbeId(range, mode),
    from: range.from,
    to: range.to,
    mode,
    depth: built.appliedDepth,
    maxDepth: built.maxDepth,
    cachedCode: built.code,
    canvasWidth: DEFAULT_PROBE_CANVAS_WIDTH,
    canvasHeight: DEFAULT_PROBE_CANVAS_HEIGHT,
    windowDurationMs: DEFAULT_PROBE_WINDOW_DURATION_MS,
  };
}

function findTargetProbeId(
  state: EditorState,
  requireContextual: boolean,
): string | null {
  const probes = state.field(probeField).probes;
  const cursor = state.selection.main.from;

  const containing = probes.find((probe) =>
    (!requireContextual || probe.mode === "contextual") &&
    cursor >= probe.from &&
    cursor <= probe.to,
  );
  if (containing) return containing.id;

  const line = state.doc.lineAt(cursor);
  let best: PersistedProbeSpec | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const probe of probes) {
    if (requireContextual && probe.mode !== "contextual") continue;
    if (probe.from < line.from || probe.to > line.to) continue;
    const distance = Math.min(
      Math.abs(cursor - probe.from),
      Math.abs(cursor - probe.to),
    );
    if (distance < bestDistance) {
      best = probe;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

export function toggleCurrentProbe(
  view: EditorView,
  mode: ProbeMode,
): boolean {
  const range = getCurrentProbeRange(view.state);
  if (!range) return false;

  const probe = buildProbeSpec(view.state, range, mode);
  if (!probe) return false;

  view.dispatch({
    effects: toggleProbeEffect.of(probe),
  });
  return true;
}

export function expandCurrentProbeContext(view: EditorView): boolean {
  const id = findTargetProbeId(view.state, true);
  if (!id) return false;
  view.dispatch({
    effects: setProbeDepthEffect.of({ id, delta: 1 }),
  });
  return true;
}

export function contractCurrentProbeContext(view: EditorView): boolean {
  const id = findTargetProbeId(view.state, true);
  if (!id) return false;
  view.dispatch({
    effects: setProbeDepthEffect.of({ id, delta: -1 }),
  });
  return true;
}

export { probeField, probeViewPlugin };

/**
 * Create probe extensions with a custom configuration.
 * Sets the module-level config so all probe functions use the provided config.
 */
export function createProbeExtensions(config: ProbeConfig): Extension[] {
  _config = config;
  return [probeField, probeViewPlugin];
}

export const probeExtensions = createProbeExtensions(createDefaultProbeConfig());
