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
import {
  shouldSkipFutureEdgePush,
  setAdaptiveQualityEnabled,
} from "./adaptiveQuality.ts";
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
const wasmTickAndProject = (
  outputs: string[],
  tickTime: number,
  projectEnd: number,
  numFutureSamples: number,
) => wasmPort().tickAndProject(outputs, tickTime, projectEnd, numFutureSamples);

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FUTURE_LEAD_SECONDS = 1;
const MAX_FUTURE_LEAD_SECONDS = 8;
const WASM_ERROR_RESULT = "{error}";

// Default history: visible past + 5s headroom, max 30s at ~30fps
const DEFAULT_HISTORY_HEADROOM = 5;
const DEFAULT_MAX_HISTORY_SECONDS = 30;
const ASSUMED_FRAME_RATE = 30;

// ── Past buffer sample rate (pixel-matched) ─────────────────────────
//
// Spec visualisation.md §2.2.1: rolling buffer rate is derived from
// canvas pixel width — `floor(canvasWidth / 2) / (windowDuration / 2)`.
// The renderer computes this each paint and pushes via
// `setPastBufferSampleRate()`.  Past buffers are sized for
// `DEFAULT_MAX_HISTORY_SECONDS` worth of samples at this rate.
//
// Future buffers retain the rAF-driven density (one push per frame at
// the far edge, batch refill on invalidation) — see §2.2.2.
let pastBufferSampleRate = ASSUMED_FRAME_RATE;

function pastBufferCapacity(): number {
  return Math.max(
    1,
    Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * pastBufferSampleRate),
  );
}

export function getPastBufferSampleRate(): number {
  return pastBufferSampleRate;
}

/**
 * Set the target sample-rate (Hz) for the past rolling buffers.
 *
 * Called by the renderer each paint with the pixel-matched rate
 * `floor(canvasWidth / 2) / (windowDuration / 2)`.  Most paints are a
 * no-op (rate unchanged); on a real change every existing past buffer
 * is reallocated at the new capacity, **preserving in-bounds samples**.
 * Future buffers are unaffected.
 */
export function setPastBufferSampleRate(hz: number): void {
  const numeric = Number(hz);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  // Snap to integer Hz to avoid drift between paints from minor
  // floating-point fluctuations in the reported canvas size.
  const next = Math.max(1, Math.round(numeric));
  if (next === pastBufferSampleRate) return;
  pastBufferSampleRate = next;
  // Reallocate every past buffer at the new capacity, copying the
  // existing in-order samples across.  Newest samples win on overflow.
  const newCapacity = pastBufferCapacity();
  for (const [key, oldBuf] of pastBuffers) {
    const replacement = new PastBuffer(newCapacity);
    const start = Math.max(0, oldBuf.length - newCapacity);
    for (let i = start; i < oldBuf.length; i++) {
      replacement.push(oldBuf.timeAt(i), oldBuf.valueAt(i));
    }
    pastBuffers.set(key, replacement);
  }
}

// ── Past buffers & future buffers ───────────────────────────────────

const pastBuffers = new Map<string, PastBuffer>();
const futureBuffers = new Map<string, PastBuffer>();

function ensurePastBuffer(exprType: string): PastBuffer {
  let buf = pastBuffers.get(exprType);
  if (!buf) {
    buf = new PastBuffer(pastBufferCapacity());
    pastBuffers.set(exprType, buf);
  }
  return buf;
}

function ensureFutureBuffer(exprType: string): PastBuffer {
  let buf = futureBuffers.get(exprType);
  if (!buf) {
    // Future buffer capacity stays driven by the assumed frame rate —
    // it grows by one sample per frame (or batch-refills on invalidate).
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
 * Apply a Map<name, number> tick result to bar + per-output past buffers.
 *
 * The combined `useq_tick_and_project` ABI returns one tick value per
 * requested output; the legacy single-sample `evalOutputsInTimeWindow`
 * call returns a Map<name, [{time,value}]>. This helper takes a uniform
 * `name → number` view and updates the same downstream state (bar
 * store + past buffers) that both code paths must produce.
 */
function applyTickValues(
  outputs: string[],
  timeSeconds: number,
  tickValues: Map<string, number>,
): void {
  const barValue = tickValues.get("bar");
  if (typeof barValue === "number" && Number.isFinite(barValue)) {
    const wrapped = barValue % 1;
    updateBar(wrapped < 0 ? wrapped + 1 : wrapped);
  } else {
    updateBar(0);
  }
  for (const name of outputs) {
    const buf = ensurePastBuffer(name);
    const value = tickValues.get(name);
    if (typeof value === "number" && Number.isFinite(value)) {
      buf.push(timeSeconds, value);
    }
  }
}

/**
 * Per-frame tick: advance WASM state to t=now, record past values,
 * and push one future sample at the far edge of the future window.
 *
 * Future buffers grow organically (one sample per frame) and are only
 * batch-refilled on invalidation events (code eval, control changes).
 *
 * When the active port supports the combined `useq_tick_and_project`
 * export (spec visualisation.md §5.2 / §7.2), the per-frame tick + edge
 * push folds into a single boundary crossing.  Otherwise the legacy
 * 2-call path is used; behaviour is identical, only the round-trip
 * count changes.
 */
export async function tickAndProject(
  timeSeconds: number,
  settings: VisSettings,
): Promise<void> {
  const outputs = Object.keys(visStore.expressions);
  // Bar is folded into the same batch as user outputs so we never
  // need a separate round-trip just for it (must be sampled even when
  // no user expressions are registered).
  const requestedOutputs = ["bar", ...outputs];

  // Phase 2 setup — used by both the combined and legacy paths.
  const halfWindow = settings.windowDuration / 2;
  const futureEdge = timeSeconds + halfWindow + (settings.futureLeadSeconds || 0);

  // Determine which Phase 2 strategy applies.  This decides whether
  // we ask the combined export for 1 sample (steady-state edge push)
  // or futureSampleCount samples (refill).
  let needsRefill = futureInvalidated;
  if (!needsRefill) {
    for (const name of outputs) {
      const fb = futureBuffers.get(name);
      if (!fb || fb.length < 2 || fb.newestTime < futureEdge - 0.5) {
        needsRefill = true;
        break;
      }
    }
  }
  // Lever 1 (adaptive quality, spec §1.7/§9.2): under sustained frame
  // pressure, skip the per-frame future edge push when refill isn't
  // already needed.  The future trace stops extending until pressure
  // releases; when coverage runs out, the refill branch takes over.
  const skipEdgePush = !needsRefill && shouldSkipFutureEdgePush();

  // When `outputs` is empty we still need a tick for `bar`, but no
  // projection work is possible — collapse to numFutureSamples=0.
  const noUserOutputs = outputs.length === 0;

  // ── Combined path ────────────────────────────────────────────────
  // When the combined ABI is wired up, fold tick + edge-push (or
  // tick + refill) into a single round-trip.
  const portCaps = wasmPort().capabilities();
  if (portCaps.supportsTickAndProject) {
    let projectEnd: number;
    let numFutureSamples: number;
    if (noUserOutputs) {
      projectEnd = timeSeconds;
      numFutureSamples = 0;
    } else if (needsRefill) {
      projectEnd = futureEdge;
      numFutureSamples = Math.max(
        2,
        Math.ceil((futureEdge - timeSeconds) * ASSUMED_FRAME_RATE),
      );
    } else if (skipEdgePush) {
      projectEnd = timeSeconds;
      numFutureSamples = 0;
    } else {
      projectEnd = futureEdge;
      numFutureSamples = 1;
    }

    let combined;
    try {
      combined = await wasmTickAndProject(
        requestedOutputs, timeSeconds, projectEnd, numFutureSamples,
      );
    } catch (error) {
      dbg(`visualisationSampler: tickAndProject failed: ${error}`);
      combined = null;
    }

    if (combined) {
      applyTickValues(outputs, timeSeconds, combined.tickValues);

      if (noUserOutputs) {
        return;
      }
      if (needsRefill) {
        futureInvalidated = false;
        for (const name of outputs) {
          const samples = combined.projectionSamples.get(name);
          if (!samples) continue;
          const buf = ensureFutureBuffer(name);
          buf.clear();
          for (let i = 0; i < samples.length; i++) {
            if (Number.isFinite(samples[i].value)) {
              buf.push(samples[i].time, samples[i].value);
            }
          }
        }
      } else if (!skipEdgePush) {
        for (const name of outputs) {
          const samples = combined.projectionSamples.get(name);
          if (!samples || samples.length === 0) continue;
          const last = samples[samples.length - 1];
          if (Number.isFinite(last.value)) {
            ensureFutureBuffer(name).push(last.time, last.value);
          }
        }
      }
      return;
    }
    // combined === null → fall through to the legacy 2-call path.
  }

  // ── Legacy 2-call path (combined export unavailable / failed) ────
  let tickResult: Map<string, VisSample[]>;
  try {
    tickResult = await evalOutputsInTimeWindow(
      requestedOutputs, timeSeconds, timeSeconds, 1,
    );
  } catch {
    tickResult = new Map();
  }

  // Translate the legacy Map<name, VisSample[]> into the uniform
  // Map<name, number> shape applyTickValues expects.
  const tickValuesNumeric = new Map<string, number>();
  for (const name of requestedOutputs) {
    const samples = tickResult.get(name);
    if (samples && samples.length > 0) {
      tickValuesNumeric.set(name, Number(samples[0].value));
    }
  }
  applyTickValues(outputs, timeSeconds, tickValuesNumeric);

  if (outputs.length === 0) return;

  // Phase 2 (legacy)
  if (futureInvalidated) {
    futureInvalidated = false;
    await refillFutureBuffers(timeSeconds, settings);
    return;
  }

  if (needsRefill) {
    await refillFutureBuffers(timeSeconds, settings);
    return;
  }

  if (skipEdgePush) return;

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
  let adaptive: unknown = undefined;
  try {
    const vis = getAppSettings().visualisation as
      | (Partial<VisSettings> & { adaptiveQuality?: unknown })
      | null;
    visual = vis;
    adaptive = vis?.adaptiveQuality;
  } catch {
    // appSettingsRepository may still be in TDZ during early init.
  }
  // Wire the adaptive-quality toggle through to the detector.  When
  // `false`, the detector still records ticks but consumers see
  // pressure level 0 — see effects/adaptiveQuality.ts.
  setAdaptiveQualityEnabled(adaptive === undefined ? true : adaptive !== false);
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
