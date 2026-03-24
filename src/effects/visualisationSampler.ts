/**
 * Visualisation Sampler
 *
 * Pure WASM sampling logic extracted from the old visualisationController.
 * Provides functions to evaluate expressions over time windows and manage
 * the sampling lifecycle. All state lives in visualisationStore; this module
 * only contains stateless sampling helpers and the side-effectful time-update
 * handler that bridges incoming time ticks to the store.
 */

import { dbg } from "../lib/debug.ts";
import {
  evalInUseqWasm,
  updateUseqWasmTime,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
} from "../runtime/wasmInterpreter.ts";
import {
  getSerialVisPalette,
  getSerialVisChannelColor,
} from "../lib/visualisationUtils.ts";
import {
  getAppSettings,
  subscribeAppSettings,
} from "../runtime/appSettingsRepository.ts";
import { codeEvaluated as codeEvaluatedChannel } from "../contracts/runtimeChannels";
import { serialVisPaletteChangedChannel } from "../contracts/visualisationChannels";
import type { VisExpression, VisSample, VisSettings } from "../utils/visualisationStore.ts";
import {
  visStore,
  setVisStore,
  updateTime,
  updateBar,
  updateExpressions,
  updateSettings,
  setVisPalette,
  removeExpression,
  setLastChangeKind,
} from "../utils/visualisationStore.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FUTURE_LEAD_SECONDS = 1;
const MAX_FUTURE_LEAD_SECONDS = 8;
const SAMPLE_EPSILON = 1e-9;

// ── Staleness guard ──────────────────────────────────────────────────
// Monotonic counter incremented on every resampleExpressions() call.
// If async WASM work finishes and the counter has moved on, the result
// is stale and must be discarded.
let samplingSequence = 0;

// ── Settings helpers ─────────────────────────────────────────────────

interface SamplingSettings {
  windowDuration: number;
  sampleCount: number;
  futureLeadSeconds: number;
}

interface SamplingWindow {
  start: number;
  end: number;
  step: number;
  total: number;
}

function getDefaults(): VisSettings {
  return {
    windowDuration: 10,
    sampleCount: 100,
    lineWidth: 1.5,
    futureDashed: true,
    futureMaskOpacity: 0.35,
    futureMaskWidth: 12,
    circularOffset: 0,
    futureLeadSeconds: DEFAULT_FUTURE_LEAD_SECONDS,
    digitalLaneGap: 4,
  };
}

function clampSettings(raw: Partial<VisSettings> | null): VisSettings {
  const defaults = getDefaults();
  const safe: VisSettings = { ...defaults, ...(raw || {}) };
  safe.windowDuration = Math.min(
    20,
    Math.max(1, Number(safe.windowDuration) || defaults.windowDuration),
  );
  safe.sampleCount = Math.max(
    2,
    Math.min(400, Math.floor(Number(safe.sampleCount) || defaults.sampleCount)),
  );
  safe.lineWidth = Math.min(
    5,
    Math.max(0.5, Number(safe.lineWidth) || defaults.lineWidth),
  );
  safe.futureDashed = safe.futureDashed !== false;
  const opacity = Number(safe.futureMaskOpacity);
  safe.futureMaskOpacity = Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity))
    : defaults.futureMaskOpacity;
  safe.futureMaskWidth = Math.min(
    48,
    Math.max(4, Number(safe.futureMaskWidth) || defaults.futureMaskWidth),
  );
  const circularOffsetNumeric = Number(safe.circularOffset);
  safe.circularOffset = Number.isFinite(circularOffsetNumeric)
    ? Math.round(circularOffsetNumeric)
    : defaults.circularOffset;
  const leadNumeric = Number(safe.futureLeadSeconds);
  safe.futureLeadSeconds = Number.isFinite(leadNumeric)
    ? Math.min(MAX_FUTURE_LEAD_SECONDS, Math.max(0, leadNumeric))
    : DEFAULT_FUTURE_LEAD_SECONDS;
  const digitalGapNumeric = Number(safe.digitalLaneGap);
  safe.digitalLaneGap = Number.isFinite(digitalGapNumeric)
    ? Math.min(40, Math.max(0, digitalGapNumeric))
    : defaults.digitalLaneGap;
  return safe;
}

function sampleStep(settings: SamplingSettings): number {
  const windowDuration = Number.isFinite(settings.windowDuration)
    ? settings.windowDuration
    : 0;
  const sampleCount = Number.isFinite(settings.sampleCount)
    ? settings.sampleCount
    : 0;
  if (sampleCount <= 1) return windowDuration;
  if (windowDuration <= 0) return 0;
  return windowDuration / (sampleCount - 1);
}

function totalSamplesForSettings(
  step: number,
  settings: SamplingSettings,
): number {
  const baseCount = Math.max(1, settings.sampleCount);
  if (!Number.isFinite(step) || step <= SAMPLE_EPSILON) return baseCount;
  const lead = settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS;
  const extra = lead > SAMPLE_EPSILON ? Math.ceil(lead / step) : 0;
  return baseCount + extra;
}

function computeSamplingWindow(
  currentTime: number,
  settings: SamplingSettings,
): SamplingWindow {
  const step = sampleStep(settings);
  const total = totalSamplesForSettings(step, settings);
  const halfWindow = settings.windowDuration / 2;
  const rawStart = currentTime - halfWindow;
  const start = step > SAMPLE_EPSILON
    ? Math.floor(rawStart / step) * step
    : rawStart;
  const end = start + step * (total - 1);

  return { start, end, step, total };
}

function samplingWindowKey(window: SamplingWindow): string {
  return `${window.start}:${window.step}:${window.total}`;
}

let lastRequestedSamplingWindowKey: string | null = null;
let lastCompletedSamplingWindowKey: string | null = null;

function invalidateSamplingWindowCache(): void {
  lastRequestedSamplingWindowKey = null;
  lastCompletedSamplingWindowKey = null;
}

// ── Sampling functions ───────────────────────────────────────────────

async function buildSamples(
  exprType: string,
  start: number,
  end: number,
  count: number,
): Promise<VisSample[]> {
  if (count <= 0) return [];

  try {
    const batchResults = await evalOutputsInTimeWindow(
      [exprType],
      start,
      end,
      count,
    );
    return batchResults.get(exprType) || [];
  } catch (error) {
    dbg(
      `visualisationSampler: batch failed for ${exprType}, falling back: ${error}`,
    );
    const step = count > 1 ? (end - start) / (count - 1) : 0;
    const samples: VisSample[] = [];
    for (let i = 0; i < count; i++) {
      const time = start + step * i;
      const value = await evalOutputAtTime(exprType, time);
      samples.push({ time, value: Number(value) || 0 });
    }
    return samples;
  }
}

async function sampleExpression(
  exprType: string,
  currentTime: number,
  settings: SamplingSettings,
): Promise<VisSample[]> {
  const window = computeSamplingWindow(currentTime, settings);
  return buildSamples(exprType, window.start, window.end, window.total);
}

function resolveColor(
  exprType: string,
  circularOffset: number,
): string | null {
  const palette = getSerialVisPalette();
  return getSerialVisChannelColor(exprType, circularOffset, palette);
}

// ── Refresh bar ──────────────────────────────────────────────────────

async function refreshBarValue(timeSeconds: number): Promise<void> {
  try {
    const result = await evalOutputAtTime("bar", timeSeconds);
    const numeric = Number(result);
    if (Number.isFinite(numeric)) {
      const wrapped = numeric % 1;
      updateBar(wrapped < 0 ? wrapped + 1 : wrapped);
      return;
    }
  } catch (error) {
    dbg(`visualisationSampler: failed to read bar value: ${error}`);
  }
  updateBar(0);
}

// ── Rebuild all expression samples ───────────────────────────────────

async function rebuildAllExpressions(
  settings: VisSettings,
  currentTime: number,
): Promise<void> {
  const expressions = visStore.expressions;
  const exprTypes = Object.keys(expressions);
  if (exprTypes.length === 0) return;

  // Compute the shared sample window ONCE for all expressions.
  const window = computeSamplingWindow(currentTime, settings);
  const currentWindowKey = samplingWindowKey(window);

  // Batch ALL expressions into a single WASM call.
  let batchResults: Map<string, VisSample[]>;
  try {
    batchResults = await evalOutputsInTimeWindow(
      exprTypes,
      window.start,
      window.end,
      window.total,
    );
  } catch (error) {
    dbg(`visualisationSampler: batch rebuild failed, falling back to per-expression: ${error}`);
    batchResults = new Map();
    const fallbacks = await Promise.all(
      exprTypes.map((exprType) =>
        sampleExpression(exprType, currentTime, settings)
          .then((samples) => [exprType, samples] as const)
          .catch((innerError) => {
            dbg(`visualisationSampler: fallback failed for ${exprType}: ${innerError}`);
            return [exprType, undefined] as const;
          }),
      ),
    );
    for (const [exprType, samples] of fallbacks) {
      if (samples) batchResults.set(exprType, samples);
    }
  }

  lastCompletedSamplingWindowKey = currentWindowKey;

  // Build updated expression records from the batch results.
  const rebuilt: Record<string, VisExpression> = {};
  for (const exprType of exprTypes) {
    const expr = expressions[exprType];
    if (!expr) continue;
    const samples = batchResults.get(exprType);
    if (samples) {
      rebuilt[exprType] = {
        ...expr,
        samples,
        color: resolveColor(exprType, settings.circularOffset),
      };
    } else {
      rebuilt[exprType] = { ...expr };
    }
  }

  // Merge with current store state to preserve any expressions that were
  // registered concurrently (avoids stale-snapshot overwrites).
  const current = visStore.expressions;
  const merged = { ...current };
  for (const [key, value] of Object.entries(rebuilt)) {
    if (key in current) {
      merged[key] = value;
    }
    // If key was removed from current during rebuild, don't re-add it.
  }
  updateExpressions(merged);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Resample all registered expressions at the given time.
 *
 * This is pure sampling work — it does NOT update the store's currentTime.
 * Callers are responsible for time advancement:
 * - Local clock: `localClock.ts` updates time on every rAF frame
 * - Hardware: `stream-parser.ts` updates time when serial data arrives
 *
 * This function can safely be called fire-and-forget; if it takes longer
 * than a frame, the clock keeps ticking and the renderer interpolates.
 */
export async function resampleExpressions(
  timeSeconds: number,
): Promise<void> {
  const seq = ++samplingSequence;
  const numericTime = Number(timeSeconds) || 0;
  const settings = visStore.settings;

  try {
    await updateUseqWasmTime(numericTime);
  } catch (error) {
    dbg(`visualisationSampler: failed to update interpreter time: ${error}`);
    return;
  }

  // A newer resample request arrived while we were awaiting — discard.
  if (seq !== samplingSequence) return;

  await refreshBarValue(numericTime);

  const expressions = visStore.expressions;
  if (Object.keys(expressions).length > 0) {
    const currentWindowKey = samplingWindowKey(
      computeSamplingWindow(numericTime, settings),
    );
    const shouldRebuild = currentWindowKey !== lastRequestedSamplingWindowKey
      && currentWindowKey !== lastCompletedSamplingWindowKey;

    if (shouldRebuild) {
      lastRequestedSamplingWindowKey = currentWindowKey;
      await rebuildAllExpressions(settings, numericTime);
    }
  }

  // Final staleness check after async work completes.
  if (seq !== samplingSequence) return;

  setLastChangeKind("data");
}

// Backward-compatible alias
export { resampleExpressions as handleExternalTimeUpdate };

/**
 * Register (or update) an expression for visualisation.
 * Evaluates it in WASM and populates initial samples.
 */
export async function registerVisualisation(
  exprType: string,
  expressionText: string,
): Promise<void> {
  const trimmed = (expressionText || "").trim();
  if (!trimmed) {
    removeExpression(exprType);
    invalidateSamplingWindowCache();
    setLastChangeKind("unregister", { exprType });
    return;
  }

  await evalInUseqWasm(trimmed);

  const settings = visStore.settings;
  const currentTime = visStore.currentTime;
  const samples = await sampleExpression(exprType, currentTime, settings);
  const color = resolveColor(exprType, settings.circularOffset);

  const expressions = { ...visStore.expressions };
  expressions[exprType] = {
    exprType,
    expressionText: trimmed,
    samples,
    color,
  };
  updateExpressions(expressions);
  invalidateSamplingWindowCache();
  setLastChangeKind("register", { exprType });
}

/**
 * Remove an expression from visualisation.
 */
export function unregisterVisualisation(exprType: string): void {
  removeExpression(exprType);
  invalidateSamplingWindowCache();
  setLastChangeKind("unregister", { exprType });
}

/**
 * Toggle an expression on/off in the visualisation.
 */
export async function toggleVisualisation(
  exprType: string,
  expressionText: string,
): Promise<void> {
  if (isExpressionVisualised(exprType)) {
    unregisterVisualisation(exprType);
  } else {
    await registerVisualisation(exprType, expressionText);
  }
}

/**
 * Check if an expression is currently being visualised.
 */
export function isExpressionVisualised(exprType: string): boolean {
  return exprType in visStore.expressions;
}

/**
 * Refresh a single expression's samples after its code changes.
 */
export async function refreshVisualisedExpression(
  exprType: string,
  expressionText: string,
): Promise<void> {
  const expr = visStore.expressions[exprType];
  if (!expr) return;

  const trimmed = (expressionText || "").trim();
  if (expr.expressionText === trimmed) return;

  try {
    await evalInUseqWasm(trimmed);
  } catch (error) {
    dbg(
      `visualisationSampler: failed to update interpreter for ${exprType}: ${error}`,
    );
  }

  const settings = visStore.settings;
  const currentTime = visStore.currentTime;
  const samples = await sampleExpression(exprType, currentTime, settings);
  const color = resolveColor(exprType, settings.circularOffset);

  const expressions = { ...visStore.expressions };
  expressions[exprType] = {
    exprType,
    expressionText: trimmed,
    samples,
    color,
  };
  updateExpressions(expressions);
  invalidateSamplingWindowCache();
  setLastChangeKind("update");
}

/**
 * Notify that an expression was evaluated (code changed) and needs re-sampling.
 */
export function notifyExpressionEvaluated(exprType: string | null = null): void {
  const expressions = visStore.expressions;
  if (Object.keys(expressions).length === 0) return;

  const settings = visStore.settings;
  const currentTime = visStore.currentTime;
  invalidateSamplingWindowCache();

  rebuildAllExpressions(settings, currentTime)
    .then(() => setLastChangeKind("data"))
    .catch((error) => {
      dbg(
        `visualisationSampler: unhandled error during rebuild: ${error}`,
      );
    });
}

/**
 * Report a color for an expression (used by editor gutter).
 */
export function reportExpressionColor(
  exprType: string,
  color: string | null,
): void {
  const expr = visStore.expressions[exprType];
  if (!expr) return;

  const appliedColor =
    color || resolveColor(exprType, visStore.settings.circularOffset);
  if (!appliedColor) return;

  const expressions = { ...visStore.expressions };
  expressions[exprType] = { ...expr, color: appliedColor };
  updateExpressions(expressions);
}

// ── Subscriptions (side effects) ─────────────────────────────────────

function loadAndApplySettings(): VisSettings {
  let visual: Partial<VisSettings> | null = null;
  try {
    visual = getAppSettings().visualisation as Partial<VisSettings> | null;
  } catch {
    // appSettingsRepository may still be in TDZ during early init.
  }
  const settings = clampSettings(visual);
  updateSettings(settings);
  return settings;
}

function refreshAllColors(settings: VisSettings): void {
  const palette = getSerialVisPalette();
  const offset = settings.circularOffset ?? 0;
  const expressions = visStore.expressions;
  const updated: Record<string, VisExpression> = {};
  let changed = false;
  for (const [key, expr] of Object.entries(expressions)) {
    const color = getSerialVisChannelColor(key, offset, palette);
    if (color !== expr.color) {
      updated[key] = { ...expr, color };
      changed = true;
    } else {
      updated[key] = expr;
    }
  }
  if (changed) {
    updateExpressions(updated);
  }
  invalidateSamplingWindowCache();
}

if (typeof window !== "undefined") {
  // Defer subscriptions to avoid TDZ errors during module init.
  // The entire block is wrapped in try-catch because appSettingsRepository
  // may not have finished initialising its module-level state.
  setTimeout(() => {
    try {
      const settings = loadAndApplySettings();

      subscribeAppSettings(() => {
        const newSettings = loadAndApplySettings();
        const currentTime = visStore.currentTime;
        invalidateSamplingWindowCache();
        rebuildAllExpressions(newSettings, currentTime)
          .then(() => setLastChangeKind("settings"))
          .catch((error) => {
            dbg(
              `visualisationSampler: failed to refresh after settings change: ${error}`,
            );
          });
      });
    } catch {
      // TDZ — appSettingsRepository not ready. Settings will be applied
      // when the first time update arrives instead.
    }
  }, 0);

  codeEvaluatedChannel.subscribe(() => {
    notifyExpressionEvaluated();
  });

  serialVisPaletteChangedChannel.subscribe((detail) => {
    if (Array.isArray(detail?.palette)) {
      setVisPalette(detail.palette);
    }
    refreshAllColors(visStore.settings);
    setLastChangeKind("palette");
  });
}
