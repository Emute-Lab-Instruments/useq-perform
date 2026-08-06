import type { EditorState } from "@codemirror/state";

import { dbg } from "../../../lib/debug.ts";
import { perf } from "../../../lib/perfTrace.ts";
import { visStore } from "../../../utils/visualisationStore.ts";
import {
  buildProbeExpression,
  computeFromListIndex,
  type IndexedFormTarget,
} from "../probeHelpers.ts";
import {
  DEFAULT_PROBE_SAMPLE_COUNT,
  type FromListHighlight,
  type HighlightMode,
  type PersistedProbeSpec,
  type ProbeBatchResult,
  type ProbeConfig,
  type ProbeRenderUpdate,
} from "./probeTypes.ts";

const ERROR_PREFIX = "Error:";
export const MAX_PROBE_SLOTS = 8;

function formatSampleScalar(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function formatOffset(offsetSeconds: number): string {
  if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) < 1e-9) {
    return "0";
  }
  return offsetSeconds.toFixed(6).replace(/\.?0+$/, "");
}

function buildEvalAtTimeExpression(
  code: string,
  timeSeconds: number,
): string {
  return `(eval-at-time ${formatOffset(timeSeconds)} ${code})`;
}

function buildBatchSampleExpression(
  code: string,
  times: readonly number[],
): string {
  if (times.length === 0) return "[]";
  return `[${times
    .map((time) => buildEvalAtTimeExpression(code, time))
    .join(" ")}]`;
}

function parseNumericVector(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const parts = inner.split(/[\s,]+/).filter(Boolean);
  const values = new Array<number>(parts.length);
  for (let index = 0; index < parts.length; index++) {
    const value = Number(parts[index]);
    if (!Number.isFinite(value)) return null;
    values[index] = value;
  }
  return values;
}

export async function defaultEvalExpressionAtTimes(
  evalExpression: (code: string) => Promise<string | null>,
  code: string,
  times: readonly number[],
): Promise<ProbeBatchResult | null> {
  if (times.length === 0) return { samples: [], current: "" };

  let raw: string | null;
  try {
    raw = await evalExpression(buildBatchSampleExpression(code, times));
  } catch {
    return null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith(ERROR_PREFIX)) return null;
  const samples = parseNumericVector(trimmed);
  if (!samples || samples.length !== times.length) return null;
  const last = samples[samples.length - 1];
  return {
    samples,
    current: Number.isFinite(last) ? formatSampleScalar(last) : trimmed,
  };
}

async function evaluateProbeCode(
  config: ProbeConfig,
  code: string,
): Promise<string> {
  const result = await config.evalExpression(code);
  return typeof result === "string" ? result.trim() : String(result ?? "").trim();
}

function isErrorResult(text: string): boolean {
  return text.startsWith(ERROR_PREFIX);
}

async function sampleWaveform(
  config: ProbeConfig,
  code: string,
  currentTime: number,
  windowDuration: number,
  sampleCount: number,
): Promise<{ current: string; samples: number[] }> {
  const startTime = currentTime - windowDuration;
  const count = Math.max(2, Math.floor(sampleCount) || DEFAULT_PROBE_SAMPLE_COUNT);
  const step = count > 1 ? windowDuration / (count - 1) : windowDuration;
  const times = Array.from({ length: count }, (_, index) => startTime + step * index);

  if (import.meta.env.DEV) perf.begin("probe-batch-eval");
  try {
    const batch = await config.evalExpressionAtTimes(code, times);
    if (batch?.samples.length === count) {
      if (import.meta.env.DEV) {
        perf.count("probe-batch-success");
        perf.count("probe-batch-samples", count);
        perf.end("probe-batch-eval");
      }
      return { current: batch.current, samples: batch.samples };
    }
    if (batch?.samples.length === 0 && batch.current) {
      if (import.meta.env.DEV) {
        perf.count("probe-batch-non-numeric");
        perf.end("probe-batch-eval");
      }
      return { current: batch.current, samples: [] };
    }
  } catch (error) {
    dbg(`probe: batch sample failed for ${code} (${error})`);
  }
  if (import.meta.env.DEV) {
    perf.count("probe-batch-fallback");
    perf.end("probe-batch-eval");
  }

  const samples: number[] = [];
  let currentResult = "";
  for (let index = 0; index < count; index++) {
    const result = await evaluateProbeCode(
      config,
      buildEvalAtTimeExpression(code, times[index]),
    );
    if (index === count - 1) currentResult = result;
    const numeric = Number(result);
    if (!Number.isFinite(numeric)) {
      return { current: currentResult || result, samples: [] };
    }
    samples.push(numeric);
  }
  return { current: currentResult, samples };
}

async function sampleWaveformViaSlot(
  config: ProbeConfig,
  slotId: number,
  code: string,
  currentTime: number,
  windowDuration: number,
  sampleCount: number,
): Promise<{ current: string; samples: number[] } | null> {
  if (await config.probeSet(slotId, code) < 0) return null;
  const count = Math.max(2, Math.floor(sampleCount) || DEFAULT_PROBE_SAMPLE_COUNT);
  const raw = await config.probeSample(
    slotId,
    currentTime - windowDuration,
    currentTime,
    count,
  );
  if (!raw || raw.length === 0) return null;
  const samples = Array.from(raw);
  const last = samples[samples.length - 1];
  return {
    samples,
    current: Number.isFinite(last) ? formatSampleScalar(last) : "NaN",
  };
}

export async function buildRenderForProbe(
  config: ProbeConfig,
  state: EditorState,
  probe: PersistedProbeSpec,
  currentTime: number,
  settings: { probeSampleCount: number },
  slotId?: number,
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
  const windowDuration = (probe.windowDurationMs / 1000) * temporalScale;
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
        windowStart: currentTime - windowDuration,
        windowDuration,
        depth,
        maxDepth,
      },
    };
  }

  const attempts = [candidateCode];
  if (probe.cachedCode && probe.cachedCode !== candidateCode) {
    attempts.push(probe.cachedCode);
  }
  let lastError: string | null = null;
  for (const code of attempts) {
    try {
      const slotSample = slotId == null
        ? null
        : await sampleWaveformViaSlot(
            config,
            slotId,
            code,
            currentTime,
            windowDuration,
            sampleCount,
          );
      const sample = slotSample ?? await sampleWaveform(
        config,
        code,
        currentTime,
        windowDuration,
        sampleCount,
      );
      const nextProbe = { ...probe, cachedCode: code, maxDepth, depth };
      if (sample.samples.length === 0) {
        return {
          probe: nextProbe,
          render: {
            revision: 0,
            kind: isErrorResult(sample.current) ? "error" : "text",
            text: sample.current || "nil",
            samples: [],
            currentTime,
            windowStart: currentTime - windowDuration,
            windowDuration,
            depth,
            maxDepth,
          },
        };
      }
      return {
        probe: nextProbe,
        render: {
          revision: 0,
          kind: "waveform",
          text: sample.current,
          samples: sample.samples,
          currentTime,
          windowStart: currentTime - windowDuration,
          windowDuration,
          depth,
          maxDepth,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      dbg(`probe: sample failed for ${probe.id} (${error})`);
    }
  }

  return {
    probe: { ...probe, maxDepth, depth },
    render: {
      revision: 0,
      kind: "error",
      text: lastError
        ? (lastError.startsWith(ERROR_PREFIX) ? lastError : `${ERROR_PREFIX} ${lastError}`)
        : "probe unavailable",
      samples: [],
      currentTime,
      windowStart: currentTime - windowDuration,
      windowDuration,
      depth,
      maxDepth,
    },
  };
}

function highlightCacheKey(
  state: EditorState,
  form: IndexedFormTarget,
  mode: HighlightMode,
): string {
  return `${mode}|${form.operatorName ?? ""}|${state.sliceDoc(
    form.listRange.from,
    form.listRange.to,
  )}`;
}

function pushHighlightFromIndex(
  highlights: FromListHighlight[],
  form: IndexedFormTarget,
  index: number,
  mode: HighlightMode,
): boolean {
  const active = form.elementRanges[index];
  if (index < 0 || !active) return false;
  highlights.push({ from: active.from, to: active.to, mode });
  return true;
}

async function evalPhasorIndex(
  config: ProbeConfig,
  code: string,
  elementCount: number,
): Promise<number | null> {
  if (code.trim() === "bar" && visStore.lastChangeKind === "data") {
    return computeFromListIndex(elementCount, visStore.bar);
  }
  const result = await evaluateProbeCode(
    config,
    buildEvalAtTimeExpression(code, config.getCurrentTime()),
  );
  if (isErrorResult(result) || !result.trim()) return null;
  const numeric = Number(result);
  return Number.isFinite(numeric)
    ? computeFromListIndex(elementCount, numeric)
    : null;
}

async function resolvePhasorHighlight(
  config: ProbeConfig,
  freshCode: string | null,
  cacheKey: string,
  elementCount: number,
  lkg: Map<string, string>,
  indexLKG: Map<string, number>,
): Promise<number | null> {
  if (freshCode) {
    try {
      const index = await evalPhasorIndex(config, freshCode, elementCount);
      if (index != null) {
        lkg.set(cacheKey, freshCode);
        indexLKG.set(cacheKey, index);
        return index;
      }
    } catch (error) {
      dbg(`probe: fresh phasor eval failed (${error})`);
    }
  }
  const cached = lkg.get(cacheKey);
  if (!cached) return null;
  try {
    const index = await evalPhasorIndex(config, cached, elementCount);
    if (index != null) {
      indexLKG.set(cacheKey, index);
      return index;
    }
  } catch (error) {
    dbg(`probe: cached phasor eval failed (${error})`);
  }
  return indexLKG.get(cacheKey) ?? null;
}

export async function computeProbeHighlights(
  config: ProbeConfig,
  state: EditorState,
  forms: IndexedFormTarget[],
  probes: PersistedProbeSpec[],
  lkg: Map<string, string>,
  indexLKG: Map<string, number>,
): Promise<FromListHighlight[]> {
  if (import.meta.env.DEV) {
    perf.begin("probe-highlights");
    perf.count("probe-highlights-forms", forms.length);
  }
  const highlights: FromListHighlight[] = [];
  const validKeys = new Set<string>();
  for (const form of forms) {
    validKeys.add(highlightCacheKey(state, form, "contextual"));
    validKeys.add(highlightCacheKey(state, form, "raw"));
  }

  for (const form of forms) {
    const contextualKey = highlightCacheKey(state, form, "contextual");
    const contextual = buildProbeExpression(state, form.phasorRange, "contextual");
    if (import.meta.env.DEV) {
      perf.begin("probe-highlights-eval");
      perf.count("probe-highlights-eval-contextual");
    }
    const contextualIndex = await resolvePhasorHighlight(
      config,
      contextual?.code ?? null,
      contextualKey,
      form.elementRanges.length,
      lkg,
      indexLKG,
    );
    if (import.meta.env.DEV) perf.end("probe-highlights-eval");
    if (contextualIndex != null) {
      pushHighlightFromIndex(highlights, form, contextualIndex, "contextual");
    }

    const formCode = state.sliceDoc(form.formRange.from, form.formRange.to).trim();
    const rawFormProbe = probes.some((probe) => {
      if (
        probe.mode !== "raw" ||
        probe.to <= form.formRange.from ||
        probe.from >= form.formRange.to
      ) {
        return false;
      }
      return buildProbeExpression(
        state,
        { from: probe.from, to: probe.to },
        "raw",
      )?.code.trim() === formCode;
    });
    if (!rawFormProbe) continue;

    const rawKey = highlightCacheKey(state, form, "raw");
    const raw = buildProbeExpression(state, form.phasorRange, "raw");
    if (import.meta.env.DEV) {
      perf.begin("probe-highlights-eval");
      perf.count("probe-highlights-eval-raw");
    }
    const rawIndex = await resolvePhasorHighlight(
      config,
      raw?.code ?? null,
      rawKey,
      form.elementRanges.length,
      lkg,
      indexLKG,
    );
    if (import.meta.env.DEV) perf.end("probe-highlights-eval");
    if (rawIndex != null) {
      pushHighlightFromIndex(highlights, form, rawIndex, "raw");
    }
  }

  for (const key of [...lkg.keys()]) {
    if (!validKeys.has(key)) {
      lkg.delete(key);
      indexLKG.delete(key);
    }
  }
  for (const key of [...indexLKG.keys()]) {
    if (!validKeys.has(key)) indexLKG.delete(key);
  }
  if (import.meta.env.DEV) perf.end("probe-highlights");
  return highlights;
}
