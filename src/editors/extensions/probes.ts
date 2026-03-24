import {
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
  collectVisibleIndexedForms,
  computeFromListIndex,
  getCurrentProbeRange,
  type IndexedFormTarget,
  type ProbeMode,
  type ProbeRange,
} from "./probeHelpers.ts";

const PROBE_REFRESH_INTERVAL_MS = 180;
const PROBE_SAMPLE_COUNT = 20;
const DEFAULT_BAR_DURATION_SECONDS = 1;
const ERROR_PREFIX = "Error:";

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
  const loaded = load<unknown[]>(PERSISTENCE_KEYS.editorProbes, []);
  if (!Array.isArray(loaded)) return [];
  return loaded.filter(isPersistedProbeSpec).map((probe) => ({
    ...probe,
    depth: Math.max(0, Math.floor(probe.depth)),
    maxDepth: Math.max(0, Math.floor(probe.maxDepth)),
  }));
}

function persistProbes(probes: PersistedProbeSpec[]): void {
  if (probes.length === 0) {
    remove(PERSISTENCE_KEYS.editorProbes);
    return;
  }
  save(PERSISTENCE_KEYS.editorProbes, probes);
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

function drawWaveform(canvas: HTMLCanvasElement, render: ProbeRenderData): void {
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

  let min = finiteSamples[0] ?? 0;
  let max = finiteSamples[0] ?? 0;
  for (const value of finiteSamples) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (Math.abs(max - min) < 1e-9) {
    max = min + 1;
  }

  ctx.strokeStyle = "var(--accent-color, #00ff41)";
  ctx.lineWidth = 1.6;
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

class ProbeWidget extends WidgetType {
  constructor(
    private readonly probe: PersistedProbeSpec,
    private readonly render: ProbeRenderData | null,
  ) {
    super();
  }

  eq(other: ProbeWidget): boolean {
    return (
      this.probe.id === other.probe.id &&
      this.probe.depth === other.probe.depth &&
      this.probe.maxDepth === other.probe.maxDepth &&
      this.render?.revision === other.render?.revision
    );
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-probe-widget";
    root.dataset.probeId = this.probe.id;

    const chrome = document.createElement("span");
    chrome.className = "cm-probe-widget-chrome";

    const label = document.createElement("span");
    label.className = "cm-probe-widget-label";
    label.textContent = this.probe.mode === "raw"
      ? "raw"
      : `ctx ${this.probe.depth}/${this.probe.maxDepth}`;
    chrome.appendChild(label);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cm-probe-close-btn";
    close.dataset.probeId = this.probe.id;
    close.title = "Remove probe";
    close.setAttribute("aria-label", "Remove probe");
    close.textContent = "x";
    chrome.appendChild(close);

    root.appendChild(chrome);

    const body = document.createElement("span");
    body.className = "cm-probe-widget-body";

    const render = this.render;
    if (!render || render.kind === "loading") {
      const loading = document.createElement("span");
      loading.className = "cm-probe-widget-text";
      loading.textContent = "sampling...";
      body.appendChild(loading);
    } else if (render.kind === "waveform") {
      const canvas = document.createElement("canvas");
      canvas.width = 138;
      canvas.height = 46;
      drawWaveform(canvas, render);
      body.appendChild(canvas);
    } else {
      const text = document.createElement("span");
      text.className = `cm-probe-widget-text is-${render.kind}`;
      text.innerHTML = escapeHtml(render.text);
      body.appendChild(text);
    }

    root.appendChild(body);
    return root;
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
  return {
    ...next,
    revision: (existing?.revision ?? 0) + 1,
  };
}

const probeField = StateField.define<ProbeFieldValue>({
  create() {
    return buildSnapshot(readPersistedProbes(), {}, []);
  },

  update(value, tr) {
    let probes = value.probes;
    let renderById = value.renderById;
    let highlights = value.highlights;

    if (tr.docChanged) {
      probes = probes.map((probe) => {
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
  const result = await evalInUseqWasmSilently(code);
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
): Promise<{ current: string; samples: number[] }> {
  const samples: number[] = [];
  const startTime = currentTime - windowDuration;
  const step = PROBE_SAMPLE_COUNT > 1
    ? windowDuration / (PROBE_SAMPLE_COUNT - 1)
    : windowDuration;

  let currentResult = "";
  for (let index = 0; index < PROBE_SAMPLE_COUNT; index++) {
    const sampleTime = startTime + step * index;
    const result = await evaluateProbeCode(withOffset(code, sampleTime - currentTime));
    if (index === PROBE_SAMPLE_COUNT - 1) {
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
  barDuration: number,
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
  const candidateCode = liveCode || probe.cachedCode;

  if (!candidateCode) {
    return {
      probe: { ...probe, maxDepth, depth },
      render: {
        revision: 0,
        kind: "loading",
        text: "sampling...",
        samples: [],
        currentTime,
        windowStart: currentTime - barDuration,
        windowDuration: barDuration,
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
      const sample = await sampleWaveform(code, currentTime, barDuration);
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
            windowStart: currentTime - barDuration,
            windowDuration: barDuration,
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
          windowStart: currentTime - barDuration,
          windowDuration: barDuration,
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
      windowStart: currentTime - barDuration,
      windowDuration: barDuration,
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

  constructor(private readonly view: EditorView) {
    this.previousProbeSignature = JSON.stringify(
      view.state.field(probeField).probes,
    );
    this.recomputeVisibleForms(view);
    this.onClick = this.onClick.bind(this);
    this.tick = this.tick.bind(this);
    this.view.dom.addEventListener("click", this.onClick);
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.recomputeVisibleForms(update.view);
    }

    const probes = update.state.field(probeField).probes;
    const nextSignature = JSON.stringify(probes);
    if (nextSignature !== this.previousProbeSignature) {
      this.previousProbeSignature = nextSignature;
      persistProbes(probes);
    }
  }

  destroy(): void {
    if (this.frameId != null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.view.dom.removeEventListener("click", this.onClick);
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
    if (!closeButton) return;
    const id = closeButton.getAttribute("data-probe-id");
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    this.view.dispatch({ effects: removeProbeEffect.of({ id }) });
  }

  private async tick(now: number): Promise<void> {
    this.frameId = window.requestAnimationFrame(this.tick);
    if (this.samplingInFlight) return;
    if (now - this.lastRun < PROBE_REFRESH_INTERVAL_MS) return;
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
      const currentTime = visStore.currentTime;
      const barDuration = await readBarDurationSeconds();
      const updates: ProbeRenderUpdate[] = [];

      for (const probe of visibleProbes) {
        const next = await buildRenderForProbe(
          this.view.state,
          probe,
          currentTime,
          barDuration,
        );
        if (!next) continue;
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

export const probeExtensions = [
  probeField,
  probeViewPlugin,
];
