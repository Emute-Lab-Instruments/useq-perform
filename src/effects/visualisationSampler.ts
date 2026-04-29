/**
 * Visualisation Sampler
 *
 * Pure(-ish) WASM sampling helpers for visualisation.  Owns expression
 * registration, refresh, and the building blocks for time-window
 * sampling — but **not** the rAF loop, the in-flight coalescing, or the
 * sample-window deduplication across consecutive ticks.  Those concerns
 * live in `visualisationRuntime.ts`, which orchestrates this module.
 *
 * The split:
 *   - `visualisationRuntime`  → "when does sampling run?"
 *   - `visualisationSampler`  → "how does a single sample run?"
 *   - `visualisationStore`    → "what is the current state?"
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
  updateBar,
  updateExpressions,
  updateSettings,
  setVisPalette,
  removeExpression,
  setLastChangeKind,
} from "../utils/visualisationStore.ts";
import { invalidateSamplingCache } from "./visualisationRuntime.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FUTURE_LEAD_SECONDS = 1;
const MAX_FUTURE_LEAD_SECONDS = 8;
const SAMPLE_EPSILON = 1e-9;
const WASM_ERROR_RESULT = "{error}";

// ── Settings helpers ─────────────────────────────────────────────────

interface SamplingSettings {
  windowDuration: number;
  sampleCount: number;
  futureLeadSeconds: number;
}

export interface SamplingWindow {
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

/** Compute the snapped sampling window for a given time + settings. */
export function computeSamplingWindow(
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

/** Stable key for a sampling window — used by the runtime to dedupe. */
export function samplingWindowKey(window: SamplingWindow): string {
  return `${window.start}:${window.step}:${window.total}`;
}

// ── Sampling primitives ──────────────────────────────────────────────

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

function isWasmErrorResult(result: string | null | undefined): boolean {
  return typeof result === "string" && result.trim() === WASM_ERROR_RESULT;
}

// ── Bar ──────────────────────────────────────────────────────────────

/** Read the `bar` output at `timeSeconds` and update the store.  Errors are logged. */
export async function refreshBarValue(timeSeconds: number): Promise<void> {
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

/** Push the current time into WASM so subsequent batch samples are aligned. */
export async function syncInterpreterTime(timeSeconds: number): Promise<void> {
  await updateUseqWasmTime(Number(timeSeconds) || 0);
}

// ── Rebuild all expression samples ───────────────────────────────────

/**
 * Re-sample every registered expression at `currentTime` using `settings`.
 * Issues a single batch WASM call and falls back to per-expression eval
 * on failure.  Merges results into the store; identity-preserving so
 * Solid reactive consumers don't see spurious change notifications.
 *
 * The runtime is responsible for not calling this redundantly across
 * consecutive ticks — `samplingWindowKey()` provides the dedup key.
 */
export async function rebuildAllExpressions(
  settings: VisSettings,
  currentTime: number,
): Promise<void> {
  const expressions = visStore.expressions;
  const exprTypes = Object.keys(expressions);
  if (exprTypes.length === 0) return;

  const window = computeSamplingWindow(currentTime, settings);

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

  const current = visStore.expressions;
  const merged: Record<string, VisExpression> = {};
  let changed = false;

  for (const key of Object.keys(current)) {
    const expr = current[key];
    if (!expr) continue;

    const samples = batchResults.get(key);
    if (samples) {
      const color = resolveColor(key, settings.circularOffset);
      if (samples !== expr.samples || color !== expr.color) {
        merged[key] = { ...expr, samples, color };
        changed = true;
      } else {
        merged[key] = expr;
      }
    } else {
      merged[key] = expr;
    }
  }

  if (changed) {
    updateExpressions(merged);
  }
}

// ── Public expression API ────────────────────────────────────────────

/**
 * Register (or update) an expression for visualisation.  Evaluates it in
 * WASM and populates initial samples.  After this returns, the runtime
 * cache is invalidated so the next tick will re-sample.
 */
export async function registerVisualisation(
  exprType: string,
  expressionText: string,
  position?: { from: number; to: number },
): Promise<void> {
  const trimmed = (expressionText || "").trim();
  if (!trimmed) {
    removeExpression(exprType);
    invalidateSamplingCache();
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
    position,
  };
  updateExpressions(expressions);
  invalidateSamplingCache();
  setLastChangeKind("register", { exprType });
}

/** Remove an expression from visualisation. */
export function unregisterVisualisation(exprType: string): void {
  removeExpression(exprType);
  invalidateSamplingCache();
  setLastChangeKind("unregister", { exprType });
}

/** Toggle an expression on/off in the visualisation. */
export async function toggleVisualisation(
  exprType: string,
  expressionText: string,
  position?: { from: number; to: number },
): Promise<void> {
  if (isExpressionVisualised(exprType, position)) {
    unregisterVisualisation(exprType);
  } else {
    await registerVisualisation(exprType, expressionText, position);
  }
}

/**
 * Check if an expression is currently being visualised.  If `position`
 * is provided, also verifies the expression's position matches.
 */
export function isExpressionVisualised(
  exprType: string,
  position?: { from: number; to: number },
): boolean {
  const expr = visStore.expressions[exprType];
  if (!expr) return false;
  if (!position) return true;
  return expr.position?.from === position.from && expr.position?.to === position.to;
}

/** Refresh a single expression's samples after its code changes. */
export async function refreshVisualisedExpression(
  exprType: string,
  expressionText: string,
  position?: { from: number; to: number },
): Promise<void> {
  const expr = visStore.expressions[exprType];
  if (!expr) return;

  const trimmed = (expressionText || "").trim();
  if (expr.expressionText === trimmed && (!position || expr.position?.from === position.from)) return;

  let nextExpressionText = expr.expressionText;
  let shouldResample = true;
  try {
    const result = await evalInUseqWasm(trimmed);
    if (isWasmErrorResult(result)) {
      throw new Error(`uSEQ returned ${WASM_ERROR_RESULT}`);
    }
    nextExpressionText = trimmed;
  } catch (error) {
    dbg(
      `visualisationSampler: failed to update interpreter for ${exprType}: ${error}`,
    );
    try {
      const restoreResult = await evalInUseqWasm(expr.expressionText);
      if (isWasmErrorResult(restoreResult)) {
        throw new Error(`uSEQ returned ${WASM_ERROR_RESULT}`);
      }
    } catch (restoreError) {
      dbg(
        `visualisationSampler: failed to restore last good expression for ${exprType}: ${restoreError}`,
        );
      shouldResample = false;
    }
  }

  const settings = visStore.settings;
  const currentTime = visStore.currentTime;
  const samples = shouldResample
    ? await sampleExpression(exprType, currentTime, settings)
    : expr.samples;
  const color = resolveColor(exprType, settings.circularOffset);

  const expressions = { ...visStore.expressions };
  expressions[exprType] = {
    exprType,
    expressionText: nextExpressionText,
    samples,
    color,
    position: position || expr.position,
  };
  updateExpressions(expressions);
  invalidateSamplingCache();
  setLastChangeKind("update");
}

/**
 * Notify that an expression was evaluated (code changed) and needs re-sampling.
 * Triggers a cache-invalidating rebuild.  Result is awaited internally; the
 * `setLastChangeKind('data')` publishes downstream.
 */
export function notifyExpressionEvaluated(_exprType: string | null = null): void {
  const expressions = visStore.expressions;
  if (Object.keys(expressions).length === 0) return;

  const settings = visStore.settings;
  const currentTime = visStore.currentTime;
  invalidateSamplingCache();

  rebuildAllExpressions(settings, currentTime)
    .then(() => setLastChangeKind("data"))
    .catch((error) => {
      dbg(
        `visualisationSampler: unhandled error during rebuild: ${error}`,
      );
    });
}

/** Report a color for an expression (used by editor gutter). */
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
  invalidateSamplingCache();
}

if (typeof window !== "undefined") {
  // Defer subscriptions to avoid TDZ errors during module init.
  setTimeout(() => {
    try {
      const settings = loadAndApplySettings();

      subscribeAppSettings(() => {
        const newSettings = loadAndApplySettings();
        const currentTime = visStore.currentTime;
        invalidateSamplingCache();
        rebuildAllExpressions(newSettings, currentTime)
          .then(() => setLastChangeKind("settings"))
          .catch((error) => {
            dbg(
              `visualisationSampler: failed to refresh after settings change: ${error}`,
            );
          });
      });

      // Avoid "unused settings" lint noise; the variable documents that
      // the initial load happened before we subscribed.
      void settings;
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
