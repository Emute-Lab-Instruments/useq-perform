import {
  type Extension,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import {
  PERSISTENCE_KEYS,
  load,
  remove,
  save,
} from "../../lib/persistence.ts";
import { visStore } from "../../utils/visualisationStore.ts";
import { getAppSettings } from "../../runtime/appSettingsRepository.ts";
import { getActiveWasmRuntimePort } from "../../runtime/activeWasmRuntimePort.ts";
import { dbg } from "../../lib/debug.ts";
import { getProbeIntervalMultiplier } from "../../effects/adaptiveQuality.ts";
import {
  buildProbeExpression,
  collectVisibleIndexedForms,
  getCurrentProbeRange,
  type IndexedFormTarget,
  type ProbeMode,
  type ProbeRange,
} from "./probeHelpers.ts";
import { perf } from "../../lib/perfTrace.ts";
import {
  DEFAULT_PROBE_CANVAS_HEIGHT,
  DEFAULT_PROBE_CANVAS_WIDTH,
  DEFAULT_PROBE_LINE_WIDTH,
  DEFAULT_PROBE_REFRESH_INTERVAL_MS,
  DEFAULT_PROBE_SAMPLE_COUNT,
  DEFAULT_PROBE_WINDOW_DURATION_MS,
  MAX_PROBE_WINDOW_DURATION_MS,
  MIN_PROBE_WINDOW_DURATION_MS,
  type FromListHighlight,
  type PersistedProbeSpec,
  type ProbeConfig,
  type ProbeFieldValue,
  type ProbeRenderData,
  type ProbeRenderUpdate,
} from "./probes/probeTypes.ts";
import {
  highlightsEqual,
  persistProbes,
  probeSignature,
  readPersistedProbes,
  updateProbeRender,
} from "./probes/probeModel.ts";
import {
  buildProbeSnapshot,
  ProbeContextLineRenderer,
  previewProbeDepth,
  previewProbeWindowDuration,
  updateProbeDOM,
} from "./probes/probeRendering.ts";
import {
  MAX_PROBE_SLOTS,
  buildRenderForProbe,
  computeProbeHighlights,
  defaultEvalExpressionAtTimes,
} from "./probes/probeSampling.ts";

export type {
  PersistedProbeSpec,
  ProbeBatchResult,
  ProbeConfig,
} from "./probes/probeTypes.ts";

// ---------------------------------------------------------------------------
// ProbeConfig — dependency injection interface
// ---------------------------------------------------------------------------

/** Create a ProbeConfig that delegates to the existing singletons. */
export function createDefaultProbeConfig(): ProbeConfig {
  // Route through the active WASM runtime port so probes work in both
  // in-process and worker modes. The port is selected during bootstrap.
  const evalExpression = (code: string) =>
    getActiveWasmRuntimePort().evalCodeSilently(code);
  return {
    evalExpression,
    evalExpressionAtTimes: (code, times) =>
      defaultEvalExpressionAtTimes(evalExpression, code, times),
    getRefreshIntervalMs: () => {
      const vis = getAppSettings().visualisation;
      const raw = Number(vis?.probeRefreshIntervalMs);
      if (!Number.isFinite(raw)) return DEFAULT_PROBE_REFRESH_INTERVAL_MS;
      return Math.max(16, raw);
    },
    getLineWidth: () => getAppSettings().visualisation?.probeLineWidth || DEFAULT_PROBE_LINE_WIDTH,
    getDefaultSamples: () => getAppSettings().visualisation?.probeSampleCount || DEFAULT_PROBE_SAMPLE_COUNT,
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
    probeSet: (slot, code) => getActiveWasmRuntimePort().probeSet(slot, code),
    probeSample: (slot, start, end, count) => getActiveWasmRuntimePort().probeSample(slot, start, end, count),
    probeFree: (slot) => getActiveWasmRuntimePort().probeFree(slot),
    // Hardware-only mode (spec §1.6.3) is exactly "WASM disabled". The session
    // `wasmEnabled` input derives from this same setting; read it directly so
    // the probe extension doesn't pull in the heavy runtime-session graph.
    isWasmEnabled: () => getAppSettings().wasm?.enabled !== false,
  };
}

// Module-level config reference, set by createProbeExtensions.
let _config: ProbeConfig = createDefaultProbeConfig();

// Placement choice for v1: inline widget immediately after the probed form.
// Follow-up options worth testing are block widgets under the form and an
// absolutely positioned floating overlay anchored from editor coordinates.

function getProbeRefreshIntervalMs(): number {
  // Lever 2 (adaptive quality, spec §1.7/§9.2): under sustained frame
  // pressure, multiply the configured probe refresh interval (1× / 2× /
  // 4×). The persisted setting is unchanged — the multiplier is applied
  // at read time so the override evaporates when pressure releases.
  return _config.getRefreshIntervalMs() * getProbeIntervalMultiplier();
}

const toggleProbeEffect = StateEffect.define<PersistedProbeSpec>();
const removeProbeEffect = StateEffect.define<{ id: string }>();
const setProbeDepthEffect = StateEffect.define<{ id: string; delta: number }>();
const setProbeWindowDurationEffect = StateEffect.define<{ id: string; durationMs: number }>();
const updateProbeRenderEffect = StateEffect.define<{
  updates: ProbeRenderUpdate[];
  highlights: FromListHighlight[];
}>();

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

const probeField = StateField.define<ProbeFieldValue>({
  create(state) {
    // Filter out persisted probes whose positions exceed this document's length.
    // This prevents crashes when the extension is used in a smaller editor instance
    // (e.g., guide playgrounds) that shares localStorage with the main editor.
    const docLen = state.doc.length;
    const probes = readPersistedProbes(_config).filter(
      (p) => p.from <= docLen && p.to <= docLen
    );
    // Spec §1.8.3 restore semantics: rebuild each probe's expression at its
    // saved offsets and compare to the persisted `cachedCode`. If the text has
    // changed (rebuild succeeds but differs), the probe is **stale** (§1.5.5) —
    // visible, not sampling. Probes never silently rebind to mismatched text.
    const staleIds = new Set<string>();
    for (const probe of probes) {
      const rebuilt = buildProbeExpression(
        state,
        { from: probe.from, to: probe.to },
        probe.mode,
        probe.mode === "raw" ? 0 : probe.depth,
      );
      const rebuiltCode = rebuilt?.code?.trim() ?? "";
      // Only mark stale when rebuild SUCCEEDS but differs. A failed rebuild
      // (null/empty) is the fallback case (§1.5.4), handled at sample time.
      if (rebuiltCode && rebuiltCode !== probe.cachedCode.trim()) {
        staleIds.add(probe.id);
      }
    }
    return buildProbeSnapshot(probes, {}, [], _config.getLineWidth(), staleIds);
  },

  update(value, tr) {
    let probes = value.probes;
    let renderById = value.renderById;
    let highlights = value.highlights;
    let staleIds = value.staleIds;

    if (tr.docChanged) {
      // Live-edit re-binds probes to current text (§1.5.3); a document edit
      // resolves the restore-only stale condition, so clear all stale markers.
      if (staleIds.size > 0) staleIds = new Set();
      const docLen = tr.state.doc.length;
      // Map positions through the change set first, then filter by new
      // document length. Filtering before mapping would incorrectly drop
      // probes whose pre-edit positions exceed the new doc length but whose
      // post-map positions are valid (e.g. a probe at 8-11 in a 12-char doc
      // maps to 0-3 when the first 8 chars are deleted).
      probes = probes
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
        })
        .filter((p) => p.from <= docLen && p.to <= docLen);
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
          if (staleIds.has(removed.id)) {
            staleIds = new Set(staleIds);
            staleIds.delete(removed.id);
          }
        } else {
          probes = [...probes, probe];
        }
      } else if (effect.is(removeProbeEffect)) {
        const { id } = effect.value;
        probes = probes.filter((probe) => probe.id !== id);
        const { [id]: _, ...rest } = renderById;
        renderById = rest;
        if (staleIds.has(id)) {
          staleIds = new Set(staleIds);
          staleIds.delete(id);
        }
      } else if (effect.is(setProbeDepthEffect)) {
        const { id, delta } = effect.value;
        probes = probes.map((probe) => {
          if (probe.id !== id || probe.mode !== "contextual") return probe;
          const nextDepth = Math.max(0, Math.min(probe.maxDepth, probe.depth + delta));
          return nextDepth === probe.depth ? probe : { ...probe, depth: nextDepth };
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

    return buildProbeSnapshot(
      probes,
      renderById,
      highlights,
      _config.getLineWidth(),
      staleIds,
    );
  },

  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});


class ProbePlugin {
  private frameId: number | null = null;
  private lastRun = 0;
  private samplingInFlight = false;
  private visibleForms: IndexedFormTarget[] = [];
  private previousProbeSignature = "";
  /** True when the rAF tick loop should run (probes or visible indexed forms). */
  private tickLoopActive = false;
  private highlightLKG: Map<string, string> = new Map();
  private highlightIndexLKG: Map<string, number> = new Map();
  private readonly contextLines: ProbeContextLineRenderer;
  private slotMap: Map<string, number> = new Map();
  private slotFree: number[] = Array.from({ length: MAX_PROBE_SLOTS }, (_, i) => i);
  // Slots whose WASM-side probeFree() is in flight. They cannot be reallocated
  // until the free resolves, because the worker processes free/set/sample in
  // postMessage order — but a new alloc that runs before the free is even
  // initiated (e.g. allocSlot synchronous, freeSlot's await still pending) can
  // hand the same slot back to the JS side and corrupt the WASM-side compile
  // cache for the next probe. See useq-perform-k2ip.
  private slotDraining: Set<number> = new Set();

  constructor(private readonly view: EditorView) {
    const probes = view.state.field(probeField).probes;
    this.previousProbeSignature = probeSignature(probes);
    this.recomputeVisibleForms(view);
    this.tickLoopActive = probes.length > 0 || this.visibleForms.length > 0;
    this.onClick = this.onClick.bind(this);
    this.onWindowDurationInput = this.onWindowDurationInput.bind(this);
    this.tick = this.tick.bind(this);
    this.view.dom.addEventListener("click", this.onClick);
    this.view.dom.addEventListener("input", this.onWindowDurationInput);
    this.contextLines = new ProbeContextLineRenderer(this.view);
    if (this.tickLoopActive) {
      this.frameId = window.requestAnimationFrame(this.tick);
    }
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.recomputeVisibleForms(update.view);
    }

    const probes = update.state.field(probeField).probes;
    const nextSignature = probeSignature(probes);
    if (nextSignature !== this.previousProbeSignature) {
      this.previousProbeSignature = nextSignature;
      persistProbes(_config, probes);
    }

    // Start or stop the animation frame loop based on whether probes or visible indexed forms exist.
    const wasActive = this.tickLoopActive;
    this.tickLoopActive = probes.length > 0 || this.visibleForms.length > 0;
    if (this.tickLoopActive && !wasActive && this.frameId == null) {
      this.frameId = window.requestAnimationFrame(this.tick);
    } else if (!this.tickLoopActive && wasActive && this.frameId != null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    if (this.tickLoopActive && (update.docChanged || update.viewportChanged || update.geometryChanged)) {
      this.drawContextLines();
    }
  }

  private allocSlot(probeId: string): number | undefined {
    const existing = this.slotMap.get(probeId);
    if (existing != null) return existing;
    const slot = this.slotFree.pop();
    if (slot == null) return undefined;
    this.slotMap.set(probeId, slot);
    return slot;
  }

  private freeSlot(probeId: string): void {
    const slot = this.slotMap.get(probeId);
    if (slot == null) return;
    this.slotMap.delete(probeId);
    this.slotDraining.add(slot);
    _config.probeFree(slot).finally(() => {
      this.slotDraining.delete(slot);
      this.slotFree.push(slot);
    });
  }

  destroy(): void {
    if (this.frameId != null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    for (const [id] of this.slotMap) this.freeSlot(id);
    this.view.dom.removeEventListener("click", this.onClick);
    this.view.dom.removeEventListener("input", this.onWindowDurationInput);
    this.contextLines.destroy();
  }

  private drawContextLines(): void {
    this.contextLines.draw(this.view.state.field(probeField).probes);
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
        previewProbeDepth(id, nextDepth, probe.maxDepth);
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

    previewProbeWindowDuration(id, value);

    this.view.dispatch({
      effects: setProbeWindowDurationEffect.of({ id, durationMs: value }),
    });
  }

  private async tick(now: number): Promise<void> {
    this.frameId = window.requestAnimationFrame(this.tick);
    if (this.samplingInFlight) {
      if (import.meta.env.DEV) perf.count("probe-tick-skipped-inflight");
      return;
    }
    if (now - this.lastRun < getProbeRefreshIntervalMs()) {
      if (import.meta.env.DEV) perf.count("probe-tick-skipped-throttle");
      return;
    }
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

    // Spec §1.6.3 / §2.10: in hardware-only mode (WASM disabled) probes do not
    // sample and from-list highlights are not computed. Each visible probe
    // renders a visually-disabled state, retaining its last sample if any.
    if (!_config.isWasmEnabled()) {
      if (import.meta.env.DEV) perf.count("probe-tick-wasm-disabled");
      const updates: ProbeRenderUpdate[] = [];
      for (const probe of visibleProbes) {
        const existing = snapshot.renderById[probe.id];
        const disabledRender: ProbeRenderData = {
          revision: 0,
          kind: "disabled",
          text: "WASM disabled",
          samples: existing?.samples ?? [],
          currentTime: existing?.currentTime ?? 0,
          windowStart: existing?.windowStart ?? 0,
          windowDuration: probe.windowDurationMs / 1000,
          depth: probe.depth,
          maxDepth: probe.maxDepth,
        };
        updateProbeDOM(
          probe.id,
          probe,
          disabledRender,
          _config.getLineWidth(),
        );
        updates.push({
          probe,
          render: updateProbeRender(existing, disabledRender),
        });
      }
      const needHighlightClear = snapshot.highlights.length > 0;
      if (updates.length > 0 || needHighlightClear) {
        this.view.dispatch({
          effects: updateProbeRenderEffect.of({ updates, highlights: [] }),
        });
      }
      return;
    }

    if (import.meta.env.DEV) {
      perf.begin("probe-tick");
      perf.count("probe-tick-runs");
      perf.count("probe-tick-visible-probes", visibleProbes.length);
      perf.count("probe-tick-visible-forms", this.visibleForms.length);
    }
    this.samplingInFlight = true;
    try {
      const currentTime = _config.getCurrentTime();
      const updates: ProbeRenderUpdate[] = [];

      // Free slots for probes that no longer exist
      const activeIds = new Set(snapshot.probes.map((p) => p.id));
      for (const id of this.slotMap.keys()) {
        if (!activeIds.has(id)) this.freeSlot(id);
      }

      for (const probe of visibleProbes) {
        // Stale probes (§1.5.5) are visible but do not sample. The stale
        // render is supplied by the decoration builder; skip them here.
        if (snapshot.staleIds.has(probe.id)) continue;
        if (import.meta.env.DEV) perf.begin("probe-build-render");
        const slotId = this.allocSlot(probe.id);
        const next = await buildRenderForProbe(
          _config,
          this.view.state,
          probe,
          currentTime,
          {
            probeSampleCount: _config.getDefaultSamples(),
          },
          slotId,
        );
        if (import.meta.env.DEV) perf.end("probe-build-render");
        if (!next) continue;

        if (import.meta.env.DEV) perf.begin("probe-paint");
        updateProbeDOM(
          next.probe.id,
          next.probe,
          next.render,
          _config.getLineWidth(),
        );
        if (import.meta.env.DEV) perf.end("probe-paint");

        const existing = snapshot.renderById[next.probe.id];
        updates.push({
          probe: next.probe,
          render: updateProbeRender(existing, next.render),
        });
      }

      const highlightsEnabled = getAppSettings().visualisation?.fromListHighlights !== false;
      const highlights = highlightsEnabled
        ? await computeProbeHighlights(
            _config,
            this.view.state,
            this.visibleForms,
            snapshot.probes,
            this.highlightLKG,
            this.highlightIndexLKG,
          )
        : [];

      // Do not rebuild an identical decoration set on every sampling tick.
      // Replacing the mark even when the active element has not changed can
      // make the current from-list decoration visibly flicker; it also does
      // needless DOM work for the common case between index transitions.
      if (updates.length === 0 && highlightsEqual(snapshot.highlights, highlights)) {
        this.drawContextLines();
        return;
      }

      this.view.dispatch({
        effects: updateProbeRenderEffect.of({ updates, highlights }),
      });

      this.drawContextLines();
    } catch (error) {
      dbg(`probe: sampling tick failed (${error})`);
    } finally {
      this.samplingInFlight = false;
      if (import.meta.env.DEV) perf.end("probe-tick");
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
    windowDurationMs: getProbeDefaultWindowDurationMs(),
  };
}

// Spec probes.md §1.7.2: a newly-created probe inherits the global default
// window duration (`visualisation.probeDefaultWindowDurationMs`, fallback to
// the constant). Once the user adjusts a probe's window it becomes sticky —
// that stickiness is naturally achieved because each probe persists its own
// `windowDurationMs` and `setProbeWindowDurationEffect` mutates only that probe.
function getProbeDefaultWindowDurationMs(): number {
  const raw = Number(getAppSettings().visualisation?.probeDefaultWindowDurationMs);
  const value = Number.isFinite(raw) ? raw : DEFAULT_PROBE_WINDOW_DURATION_MS;
  return Math.max(
    MIN_PROBE_WINDOW_DURATION_MS,
    Math.min(MAX_PROBE_WINDOW_DURATION_MS, value),
  );
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
