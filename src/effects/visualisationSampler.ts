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
import { perf } from "../lib/perfTrace.ts";
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
import { addValueChangeListener } from "./mockControlInputs.ts";
import {
  PROJECTION_MODE_NONE,
  PROJECTION_MODE_RESET_FILL,
  PROJECTION_MODE_EXTEND,
  type ProjectionMode,
} from "../contracts/runtimePorts";
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
  projectionMode: ProjectionMode,
  projectEnd: number,
  numFutureSamples: number,
  projectionOrigin: number,
) => wasmPort().tickAndProject(outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin);

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

// Settings-aware future buffer capacity (spec m6 fix).
// Recomputed in loadAndApplySettings; defaults to a safe fallback.
let futureBufferCap = Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * ASSUMED_FRAME_RATE);

function ensureFutureBuffer(exprType: string): PastBuffer {
  let buf = futureBuffers.get(exprType);
  if (!buf || buf.capacity < futureBufferCap) {
    // Allocate (or re-allocate) at the current settings-derived capacity.
    const replacement = new PastBuffer(futureBufferCap);
    if (buf) {
      // Preserve existing samples on capacity upgrade.
      const start = Math.max(0, buf.length - futureBufferCap);
      for (let i = start; i < buf.length; i++) {
        replacement.push(buf.timeAt(i), buf.valueAt(i));
      }
    }
    buf = replacement;
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
    futureLineAlpha: 0.6,
    minFutureSampleRate: 30,
    extensionBatchSize: 4,
    inputEpsilon: DEFAULT_INPUT_EPSILON,
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
  const alphaNumeric = Number(safe.futureLineAlpha);
  safe.futureLineAlpha = Number.isFinite(alphaNumeric)
    ? Math.min(1, Math.max(0, alphaNumeric))
    : defaults.futureLineAlpha;
  const minRateNumeric = Number(safe.minFutureSampleRate);
  safe.minFutureSampleRate = Number.isFinite(minRateNumeric)
    ? Math.min(120, Math.max(1, minRateNumeric))
    : defaults.minFutureSampleRate;
  const batchNumeric = Number(safe.extensionBatchSize);
  safe.extensionBatchSize = Number.isFinite(batchNumeric)
    ? Math.min(32, Math.max(1, Math.floor(batchNumeric)))
    : defaults.extensionBatchSize;
  const epsilonNumeric = Number(safe.inputEpsilon);
  safe.inputEpsilon = Number.isFinite(epsilonNumeric)
    ? Math.min(1, Math.max(0, epsilonNumeric))
    : defaults.inputEpsilon;
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

// ── Future invalidation & frontier tracking ───────────────────────
//
// Conservative invalidation (spec §3.7, §5.5): any code eval, settings
// change, or external-input change beyond inputEpsilon resets the entire
// projection fork. Per-output selective invalidation is deferred until
// useq_output_dependencies (spec §7.4) is implemented in the WASM engine.

const DEFAULT_INPUT_EPSILON = 0.01;

let futureInvalidated = false;
let projectionFrontier = -Infinity;

export function invalidateFutureProjections(): void {
  futureInvalidated = true;
  projectionFrontier = -Infinity;
}

export function getProjectionFrontier(): number {
  return projectionFrontier;
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
 * then manage the projection fork's future buffers.
 *
 * Projection modes (spec visualisation.md §5, §7.2):
 *   - Reset-fill (mode 1): on invalidation — clone post-tick state into
 *     a new fork and fill the visible future in one batch.
 *   - Extend-frontier (mode 2): steady state — advance the existing fork
 *     by a small batch at its frontier.
 *   - None (mode 0): tick only, no projection work.
 */
export async function tickAndProject(
  timeSeconds: number,
  settings: VisSettings,
): Promise<void> {
  const outputs = Object.keys(visStore.expressions);
  const requestedOutputs = ["bar", ...outputs];
  const noUserOutputs = outputs.length === 0;

  const halfWindow = settings.windowDuration / 2;
  const futureEdge = timeSeconds + halfWindow + (settings.futureLeadSeconds || 0);

  // Compute the required future sample density (spec §3.1.2).
  const futureDensityHz = Math.max(
    settings.minFutureSampleRate,
    (settings.sampleCount || 100) / (settings.windowDuration || 1),
  );

  // Decide projection mode.
  let needsResetFill = futureInvalidated;
  if (!needsResetFill && !noUserOutputs) {
    for (const name of outputs) {
      const fb = futureBuffers.get(name);
      if (!fb || fb.length < 2) {
        needsResetFill = true;
        break;
      }
    }
  }

  // Lever 1 (adaptive quality, spec §1.7/§9.2): under sustained frame
  // pressure, skip steady-state frontier extension. Coverage running out
  // triggers a reset-fill instead.
  const skipProjection =
    !needsResetFill &&
    !noUserOutputs &&
    shouldSkipFutureEdgePush();

  const needsExtension =
    !needsResetFill &&
    !noUserOutputs &&
    !skipProjection &&
    projectionFrontier < futureEdge;

  // ── Combined path (projection-fork ABI) ──────────────────────────
  const portCaps = wasmPort().capabilities();
  if (portCaps.supportsTickAndProject) {
    let projMode: ProjectionMode;
    let projectEnd: number;
    let numSamples: number;
    let origin: number;
    let modeLabel: string;

    if (noUserOutputs || skipProjection) {
      projMode = PROJECTION_MODE_NONE;
      projectEnd = timeSeconds;
      numSamples = 0;
      origin = timeSeconds;
      modeLabel = noUserOutputs ? "no-outputs" : "skip";
    } else if (needsResetFill) {
      projMode = PROJECTION_MODE_RESET_FILL;
      projectEnd = futureEdge;
      numSamples = Math.max(
        2,
        Math.ceil((futureEdge - timeSeconds) * futureDensityHz),
      );
      origin = timeSeconds;
      modeLabel = "reset-fill";
    } else {
      projMode = PROJECTION_MODE_EXTEND;
      projectEnd = futureEdge;
      numSamples = settings.extensionBatchSize;
      origin = projectionFrontier;
      modeLabel = "extend";
    }
    if (import.meta.env.DEV) perf.count(`sampler-mode-${modeLabel}`);

    if (import.meta.env.DEV) perf.begin("sampler-combined-wasm");
    let combined;
    try {
      combined = await wasmTickAndProject(
        requestedOutputs, timeSeconds, projMode, projectEnd, numSamples, origin,
      );
    } catch (error) {
      dbg(`visualisationSampler: tickAndProject failed: ${error}`);
      // M4 fix: the WASM tick may have already committed state before
      // the projection phase threw. Falling through to the legacy path
      // would re-tick and double-advance stateful expressions. Return
      // early — one dropped frame is safer than corrupted state.
      if (import.meta.env.DEV) perf.end("sampler-combined-wasm");
      return;
    }
    if (import.meta.env.DEV) perf.end("sampler-combined-wasm");

    if (combined) {
      if (import.meta.env.DEV) perf.begin("sampler-apply-tick");
      applyTickValues(outputs, timeSeconds, combined.tickValues);
      if (import.meta.env.DEV) perf.end("sampler-apply-tick");

      if (noUserOutputs) return;

      if (projMode === PROJECTION_MODE_RESET_FILL) {
        if (import.meta.env.DEV) perf.begin("sampler-refill-apply");
        futureInvalidated = false;
        let actualFrontier = projectionFrontier;
        for (const name of outputs) {
          const samples = combined.projectionSamples.get(name);
          if (!samples) continue;
          const buf = ensureFutureBuffer(name);
          buf.clear();
          for (let i = 0; i < samples.length; i++) {
            // m2 fix (spec §6.4): truncate trace on first non-finite value.
            if (!Number.isFinite(samples[i].value)) break;
            buf.push(samples[i].time, samples[i].value);
            actualFrontier = Math.max(actualFrontier, samples[i].time);
          }
        }
        // M2 fix: advance frontier only to the actual max time pushed,
        // not the requested projectEnd, to avoid suppressing re-extension.
        projectionFrontier = actualFrontier;
        if (import.meta.env.DEV) perf.end("sampler-refill-apply");
      } else if (projMode === PROJECTION_MODE_EXTEND) {
        if (import.meta.env.DEV) perf.begin("sampler-extend-apply");
        let actualFrontier = projectionFrontier;
        for (const name of outputs) {
          const samples = combined.projectionSamples.get(name);
          if (!samples || samples.length === 0) continue;
          const buf = ensureFutureBuffer(name);
          for (let i = 0; i < samples.length; i++) {
            // m2 fix (spec §6.4): truncate trace on first non-finite value.
            if (!Number.isFinite(samples[i].value)) break;
            buf.push(samples[i].time, samples[i].value);
            actualFrontier = Math.max(actualFrontier, samples[i].time);
          }
        }
        // M2 fix: advance frontier only to actual max time pushed.
        projectionFrontier = actualFrontier;
        if (import.meta.env.DEV) perf.end("sampler-extend-apply");
      }
      return;
    }
    if (import.meta.env.DEV) perf.count("sampler-combined-fallback");
  }

  // ── Legacy 2-call path (combined export unavailable / failed) ────
  if (import.meta.env.DEV) perf.begin("sampler-legacy-tick-wasm");
  let tickResult: Map<string, VisSample[]>;
  try {
    tickResult = await evalOutputsInTimeWindow(
      requestedOutputs, timeSeconds, timeSeconds, 1,
    );
  } catch {
    tickResult = new Map();
  }
  if (import.meta.env.DEV) perf.end("sampler-legacy-tick-wasm");

  const tickValuesNumeric = new Map<string, number>();
  for (const name of requestedOutputs) {
    const samples = tickResult.get(name);
    if (samples && samples.length > 0) {
      tickValuesNumeric.set(name, Number(samples[0].value));
    }
  }
  if (import.meta.env.DEV) perf.begin("sampler-apply-tick");
  applyTickValues(outputs, timeSeconds, tickValuesNumeric);
  if (import.meta.env.DEV) perf.end("sampler-apply-tick");

  if (outputs.length === 0) return;

  // Legacy path: use evalOutputsInTimeWindow for refill (no fork).
  if (futureInvalidated || needsResetFill) {
    if (import.meta.env.DEV) perf.count("sampler-legacy-refill");
    futureInvalidated = false;
    const futureSampleCount = Math.max(
      2,
      Math.ceil((futureEdge - timeSeconds) * futureDensityHz),
    );
    if (import.meta.env.DEV) perf.begin("sampler-legacy-refill-wasm");
    let futureResults: Map<string, VisSample[]>;
    try {
      futureResults = await evalOutputsInTimeWindow(
        outputs, timeSeconds, futureEdge, futureSampleCount,
      );
    } catch (error) {
      dbg(`visualisationSampler: legacy refill failed: ${error}`);
      if (import.meta.env.DEV) perf.end("sampler-legacy-refill-wasm");
      return;
    }
    if (import.meta.env.DEV) perf.end("sampler-legacy-refill-wasm");
    for (const [name, samples] of futureResults) {
      const buf = ensureFutureBuffer(name);
      buf.clear();
      for (let i = 0; i < samples.length; i++) {
        if (Number.isFinite(samples[i].value)) {
          buf.push(samples[i].time, samples[i].value);
        }
      }
    }
    projectionFrontier = futureEdge;
    return;
  }

  if (skipProjection) {
    if (import.meta.env.DEV) perf.count("sampler-legacy-skipped");
    return;
  }

  // Legacy steady-state: push one sample at the far edge.
  if (import.meta.env.DEV) perf.begin("sampler-legacy-edge-wasm");
  let edgeValues: Map<string, VisSample[]>;
  try {
    edgeValues = await evalOutputsInTimeWindow(
      outputs, futureEdge, futureEdge, 1,
    );
  } catch {
    if (import.meta.env.DEV) perf.end("sampler-legacy-edge-wasm");
    return;
  }
  if (import.meta.env.DEV) perf.end("sampler-legacy-edge-wasm");
  for (const [name, samples] of edgeValues) {
    if (samples.length > 0 && Number.isFinite(samples[0].value)) {
      ensureFutureBuffer(name).push(futureEdge, samples[0].value);
    }
  }
  projectionFrontier = futureEdge;
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
  projectionFrontier = -Infinity;

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

  // m6 fix: recompute future buffer capacity from settings so high-density
  // configurations don't overflow the ring buffer. 1.5x headroom, floored
  // at the default and capped at 8192.
  const MIN_FUTURE_CAP = Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * ASSUMED_FRAME_RATE);
  const MAX_FUTURE_CAP = 8192;
  const settingsCap = Math.ceil(
    (settings.windowDuration + (settings.futureLeadSeconds || 0)) *
    settings.minFutureSampleRate * 1.5,
  );
  futureBufferCap = Math.min(MAX_FUTURE_CAP, Math.max(MIN_FUTURE_CAP, settingsCap));

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

  // External input changes beyond inputEpsilon invalidate the
  // projection fork (spec §4.4). Conservative: invalidates ALL
  // outputs regardless of which inputs they reference. Per-output
  // invalidation requires useq_output_dependencies (spec §7.4).
  addValueChangeListener((_name, newValue, oldValue) => {
    const epsilon = visStore.settings.inputEpsilon ?? DEFAULT_INPUT_EPSILON;
    if (Math.abs(newValue - oldValue) > epsilon) {
      invalidateFutureProjections();
      setLastChangeKind("data");
    }
  });

  serialVisPaletteChangedChannel.subscribe((detail) => {
    if (Array.isArray(detail?.palette)) {
      setVisPalette(detail.palette);
    }
    refreshAllColors(visStore.settings);
    setLastChangeKind("palette");
  });
}
