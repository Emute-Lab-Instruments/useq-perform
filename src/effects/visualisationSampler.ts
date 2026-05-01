/**
 * Visualisation Sampler — faithful-past / projected-future architecture
 *
 * Each frame the runtime calls `tickAndProject()`:
 *   1. Tick — advance WASM state to t=now, record output values in
 *      per-output rolling buffers (PastBuffer).
 *   2. Project — batch-evaluate future window from t=now forward with
 *      save/restore (live state is not corrupted).
 *
 * The renderer reads per-output data via `getRenderData()`.
 *
 * Expression lifecycle functions (register/unregister/refresh) manage
 * the rolling buffers and future projections.  Past buffers are never
 * cleared on expression change — they show what actually happened.
 */

import { dbg } from "../lib/debug.ts";
import { PastBuffer } from "../lib/PastBuffer.ts";
import { getActiveWasmRuntimePort } from "../runtime/activeWasmRuntimePort.ts";
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

// ── WASM port ───────────────────────────────────────────────────────

const wasmPort = () => getActiveWasmRuntimePort();
const evalInUseqWasm = (code: string): Promise<string | null> =>
  wasmPort().evalCode(code);
const updateUseqWasmTime = (timeSeconds: number): Promise<void> =>
  wasmPort().updateTime(timeSeconds);
const evalOutputsInTimeWindow = (
  outputs: string[],
  startTime: number,
  endTime: number,
  numSamples: number,
) => wasmPort().evalOutputsInTimeWindow(outputs, startTime, endTime, numSamples);

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FUTURE_LEAD_SECONDS = 1;
const MAX_FUTURE_LEAD_SECONDS = 8;
const WASM_ERROR_RESULT = "{error}";

// Default history: visible past + 5s headroom, max 30s at ~30fps
const DEFAULT_HISTORY_HEADROOM = 5;
const DEFAULT_MAX_HISTORY_SECONDS = 30;
const ASSUMED_FRAME_RATE = 30;

// ── Past buffers & future buffers ───────────────────────────────────

const pastBuffers = new Map<string, PastBuffer>();
const futureBuffers = new Map<string, PastBuffer>();

function ensurePastBuffer(exprType: string): PastBuffer {
  let buf = pastBuffers.get(exprType);
  if (!buf) {
    const capacity = Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * ASSUMED_FRAME_RATE);
    buf = new PastBuffer(capacity);
    pastBuffers.set(exprType, buf);
  }
  return buf;
}

function ensureFutureBuffer(exprType: string): PastBuffer {
  let buf = futureBuffers.get(exprType);
  if (!buf) {
    const capacity = Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * ASSUMED_FRAME_RATE);
    buf = new PastBuffer(capacity);
    futureBuffers.set(exprType, buf);
  }
  return buf;
}

function destroyBuffers(exprType: string): void {
  pastBuffers.delete(exprType);
  futureBuffers.delete(exprType);
}

// ── Render data (read by the renderer each frame) ───────────────────

export interface OutputRenderData {
  pastBuffer: PastBuffer;
  futureBuffer: PastBuffer | undefined;
}

export function getRenderData(exprType: string): OutputRenderData | null {
  const buf = pastBuffers.get(exprType);
  if (!buf) return null;
  return {
    pastBuffer: buf,
    futureBuffer: futureBuffers.get(exprType),
  };
}

// ── Settings helpers ─────────────────────────────────────────────────

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

// ── Future invalidation ────────────────────────────────────────────

let futureInvalidated = false;

export function invalidateFutureProjections(): void {
  futureInvalidated = true;
}

async function refillFutureBuffers(
  timeSeconds: number,
  settings: VisSettings,
): Promise<void> {
  const outputs = Object.keys(visStore.expressions);
  if (outputs.length === 0) return;

  const halfWindow = settings.windowDuration / 2;
  const futureEnd = timeSeconds + halfWindow + (settings.futureLeadSeconds || 0);
  const futureSampleCount = Math.max(
    2,
    Math.ceil((futureEnd - timeSeconds) * ASSUMED_FRAME_RATE),
  );

  let futureResults: Map<string, VisSample[]>;
  try {
    futureResults = await evalOutputsInTimeWindow(
      outputs, timeSeconds, futureEnd, futureSampleCount,
    );
  } catch (error) {
    dbg(`visualisationSampler: future refill failed: ${error}`);
    return;
  }

  for (const [name, samples] of futureResults) {
    const buf = ensureFutureBuffer(name);
    buf.clear();
    for (let i = 0; i < samples.length; i++) {
      if (Number.isFinite(samples[i].value)) {
        buf.push(samples[i].time, samples[i].value);
      }
    }
  }
}

// ── Tick & Project ──────────────────────────────────────────────────

/**
 * Per-frame tick: advance WASM state to t=now, record past values,
 * and push one future sample at the far edge of the future window.
 *
 * Future buffers grow organically (one sample per frame) and are only
 * batch-refilled on invalidation events (code eval, control changes).
 */
export async function tickAndProject(
  timeSeconds: number,
  settings: VisSettings,
): Promise<void> {
  const outputs = Object.keys(visStore.expressions);

  // Phase 1: Tick past — advance state and record values.
  // Bar is folded into the same batch (saves a per-frame round-trip).
  // Bar must be sampled even when no other outputs are registered.
  const tickRequest = ["bar", ...outputs];

  let tickValues: Map<string, VisSample[]>;
  try {
    tickValues = await evalOutputsInTimeWindow(
      tickRequest, timeSeconds, timeSeconds, 1,
    );
  } catch {
    tickValues = new Map();
  }

  // Update bar from the same batch.
  const barSamples = tickValues.get("bar");
  if (barSamples && barSamples.length > 0) {
    const numeric = Number(barSamples[0].value);
    if (Number.isFinite(numeric)) {
      const wrapped = numeric % 1;
      updateBar(wrapped < 0 ? wrapped + 1 : wrapped);
    } else {
      updateBar(0);
    }
  } else {
    updateBar(0);
  }

  if (outputs.length === 0) return;

  for (const name of outputs) {
    const buf = ensurePastBuffer(name);
    const samples = tickValues.get(name);
    if (samples && samples.length > 0 && Number.isFinite(samples[0].value)) {
      buf.push(timeSeconds, samples[0].value);
    }
  }

  // Phase 2: Future — batch-refill on invalidation, else push one sample.
  if (futureInvalidated) {
    futureInvalidated = false;
    await refillFutureBuffers(timeSeconds, settings);
    return;
  }

  const halfWindow = settings.windowDuration / 2;
  const futureEdge = timeSeconds + halfWindow + (settings.futureLeadSeconds || 0);

  // Check if any future buffer needs extending (coverage running out).
  let needsExtend = false;
  for (const name of outputs) {
    const fb = futureBuffers.get(name);
    if (!fb || fb.length < 2 || fb.newestTime < futureEdge - 0.5) {
      needsExtend = true;
      break;
    }
  }

  if (needsExtend) {
    // Batch-refill when coverage is insufficient.
    await refillFutureBuffers(timeSeconds, settings);
  } else {
    // Push one future sample at the far edge (save/restore, no state corruption).
    let edgeValues: Map<string, VisSample[]>;
    try {
      edgeValues = await evalOutputsInTimeWindow(
        outputs, futureEdge, futureEdge, 1,
      );
    } catch {
      return;
    }
    for (const [name, samples] of edgeValues) {
      if (samples.length > 0 && Number.isFinite(samples[0].value)) {
        ensureFutureBuffer(name).push(futureEdge, samples[0].value);
      }
    }
  }
}

// ── Time sync ────────────────────────────────────────────────────────

export async function syncInterpreterTime(timeSeconds: number): Promise<void> {
  await updateUseqWasmTime(Number(timeSeconds) || 0);
}

// ── Public expression API ────────────────────────────────────────────

export async function registerVisualisation(
  exprType: string,
  expressionText: string,
  position?: { from: number; to: number },
): Promise<void> {
  const trimmed = (expressionText || "").trim();
  if (!trimmed) {
    removeExpression(exprType);
    destroyBuffers(exprType);
    setLastChangeKind("unregister", { exprType });
    return;
  }

  await evalInUseqWasm(trimmed);

  ensurePastBuffer(exprType);
  const fb = futureBuffers.get(exprType);
  if (fb) fb.clear();

  const color = resolveColor(exprType, visStore.settings.circularOffset);
  const expressions = { ...visStore.expressions };
  expressions[exprType] = {
    exprType,
    expressionText: trimmed,
    samples: [],
    color,
    position,
  };
  updateExpressions(expressions);
  setLastChangeKind("register", { exprType });
}

export function unregisterVisualisation(exprType: string): void {
  removeExpression(exprType);
  destroyBuffers(exprType);
  setLastChangeKind("unregister", { exprType });
}

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

export function isExpressionVisualised(
  exprType: string,
  position?: { from: number; to: number },
): boolean {
  const expr = visStore.expressions[exprType];
  if (!expr) return false;
  if (!position) return true;
  return expr.position?.from === position.from && expr.position?.to === position.to;
}

export async function refreshVisualisedExpression(
  exprType: string,
  expressionText: string,
  position?: { from: number; to: number },
): Promise<void> {
  const expr = visStore.expressions[exprType];
  if (!expr) return;

  const trimmed = (expressionText || "").trim();
  if (
    expr.expressionText === trimmed &&
    (!position || expr.position?.from === position.from)
  )
    return;

  let nextExpressionText = expr.expressionText;
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
    }
  }

  // Past buffer is preserved — future will re-project on next frame.
  const fb = futureBuffers.get(exprType);
  if (fb) fb.clear();
  futureInvalidated = true;

  const color = resolveColor(exprType, visStore.settings.circularOffset);
  const expressions = { ...visStore.expressions };
  expressions[exprType] = {
    exprType,
    expressionText: nextExpressionText,
    samples: [],
    color,
    position: position || expr.position,
  };
  updateExpressions(expressions);
  setLastChangeKind("update");
}

export function notifyExpressionEvaluated(
  _exprType: string | null = null,
): void {
  invalidateFutureProjections();
  setLastChangeKind("data");
}

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
}

if (typeof window !== "undefined") {
  setTimeout(() => {
    try {
      loadAndApplySettings();

      subscribeAppSettings(() => {
        loadAndApplySettings();
        invalidateFutureProjections();
        setLastChangeKind("settings");
      });
    } catch {
      // TDZ — appSettingsRepository not ready.
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
