/**
 * Visualisation Sampler — faithful-past / projected-future architecture
 *
 * The runtime calls `tickAndProject()` for each committed live sample:
 *   1. Tick — advance WASM state to the sample time, record output values in
 *      per-output rolling buffers (PastBuffer).
 *   2. Project — on the newest sample for a frame, batch-evaluate the
 *      future window from t=now forward with save/restore (live state is
 *      not corrupted). Intermediate catch-up samples skip projection.
 *
 * The renderer reads per-output data via `getRenderData()`.
 *
 * Expression lifecycle functions (register/unregister/refresh) manage
 * the rolling buffers and future projections.  Past buffers are never
 * cleared on expression change — they show what actually happened.
 */

import { dbg } from "../lib/debug.ts";
import { perf } from "../lib/perfTrace.ts";
import { projectionTrace } from "../lib/projectionTrace.ts";
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
import { recordDriftSample, checkDriftThreshold } from "./driftDetector";
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

// Guard band for frontier coverage (spec §3.8): expressed in seconds so
// variable rAF cadence doesn't create sawtooth coverage. The frontier is
// considered "adequate" when it reaches futureEdge + guardBand.
export const FRONTIER_GUARD_BAND_SECONDS = 0.5;

// Default history: visible past + 5s headroom, max 30s at ~30fps
const DEFAULT_HISTORY_HEADROOM = 5;
const DEFAULT_MAX_HISTORY_SECONDS = 30;
const ASSUMED_FRAME_RATE = 30;
const FUTURE_BOUNDARY_GAP_SAMPLE_MULTIPLIER = 4;

// ── Past buffer sample rate (pixel-matched) ─────────────────────────
//
// Spec visualisation.md §2.2.1: rolling buffer rate is derived from
// canvas pixel width — `floor(canvasWidth / 2) / (windowDuration / 2)`.
// The renderer computes this each paint and pushes via
// `setPastBufferSampleRate()`.  Past buffers are sized for
// `DEFAULT_MAX_HISTORY_SECONDS` worth of samples at this rate.
//
// The live temporal sampler can run at this rate too when
// `temporalSampleRateMultiplier` is 1.0.
let pastBufferSampleRate = ASSUMED_FRAME_RATE;

function pastBufferCapacity(): number {
  return Math.max(
    1,
    Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * pastBufferSampleRate),
  );
}

function futureProjectionSampleRate(settings: VisSettings): number {
  return Math.max(
    settings.minFutureSampleRate,
    (settings.sampleCount || 100) / (settings.windowDuration || 1),
    pastBufferSampleRate,
  );
}

function updateFutureBufferCapacity(settings: VisSettings): void {
  const MIN_FUTURE_CAP = Math.ceil(DEFAULT_MAX_HISTORY_SECONDS * ASSUMED_FRAME_RATE);
  const MAX_FUTURE_CAP = 8192;
  const rate = futureProjectionSampleRate(settings);
  const settingsCap = Math.ceil(
    (settings.windowDuration + (settings.futureLeadSeconds || 0)) * rate * 1.5,
  );
  futureBufferCap = Math.min(MAX_FUTURE_CAP, Math.max(MIN_FUTURE_CAP, settingsCap));
}

export function getPastBufferSampleRate(): number {
  return pastBufferSampleRate;
}

export function getTemporalSampleRate(): number {
  const multiplier = visStore.settings.temporalSampleRateMultiplier ?? 1;
  return Math.max(1, pastBufferSampleRate * multiplier);
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
  updateFutureBufferCapacity(visStore.settings);
  invalidateFutureProjections();
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
    showFutureProjection: false,
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
    temporalSampleRateMultiplier: 1,
    inputEpsilon: DEFAULT_INPUT_EPSILON,
  };
}

function clampSettings(raw: Partial<VisSettings> | null): VisSettings {
  const defaults = getDefaults();
  const safe: VisSettings = { ...defaults, ...(raw || {}) };
  safe.showFutureProjection = safe.showFutureProjection === true;
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
  const temporalMultiplierNumeric = Number(safe.temporalSampleRateMultiplier);
  safe.temporalSampleRateMultiplier = Number.isFinite(temporalMultiplierNumeric)
    ? Math.min(1, Math.max(0.05, temporalMultiplierNumeric))
    : defaults.temporalSampleRateMultiplier;
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
  if (import.meta.env.DEV) {
    projectionTrace.record("sampler-invalidate", {
      projectionFrontier,
      expressionCount: Object.keys(visStore.expressions).length,
    });
  }
}

export function getProjectionFrontier(): number {
  return projectionFrontier;
}

function futureBoundaryMaxGapSeconds(futureDensityHz: number): number {
  const safeHz = Math.max(1, futureDensityHz);
  return FUTURE_BOUNDARY_GAP_SAMPLE_MULTIPLIER / safeHz;
}

function futureExtensionSampleCount(
  origin: number,
  projectEnd: number,
  futureDensityHz: number,
  minimumBatchSize: number,
): number {
  const duration = Math.max(0, projectEnd - origin);
  return Math.max(
    minimumBatchSize,
    Math.ceil(duration * Math.max(1, futureDensityHz)),
  );
}

function futureBufferHasNearBoundaryCoverage(
  buf: PastBuffer | undefined,
  currentTime: number,
  maxGapSeconds: number,
): boolean {
  if (!buf || buf.length === 0) return false;
  for (let i = 0; i < buf.length; i++) {
    const t = buf.timeAt(i);
    if (t <= currentTime) continue;
    return t - currentTime <= maxGapSeconds;
  }
  return false;
}

function futureBufferTraceSummary(
  name: string,
  currentTime: number,
): Record<string, unknown> {
  const buf = futureBuffers.get(name);
  if (!buf) {
    return { length: 0, exists: false };
  }
  let firstFutureTime: number | null = null;
  let firstFutureValue: number | null = null;
  let firstFutureIndex: number | null = null;
  let expiredCount = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = buf.timeAt(i);
    if (t <= currentTime) {
      expiredCount++;
      continue;
    }
    firstFutureTime = t;
    firstFutureValue = buf.valueAt(i);
    firstFutureIndex = i;
    break;
  }
  return {
    exists: true,
    length: buf.length,
    capacity: buf.capacity,
    oldestTime: buf.oldestTime,
    newestTime: buf.newestTime,
    expiredCount,
    firstFutureIndex,
    firstFutureTime,
    firstFutureValue,
    firstFutureGap: firstFutureTime === null ? null : firstFutureTime - currentTime,
  };
}

function sampleTraceSummary(
  samples: VisSample[] | undefined,
  currentTime: number,
): Record<string, unknown> {
  if (!samples || samples.length === 0) {
    return { count: 0 };
  }
  let firstFiniteIndex: number | null = null;
  let lastFiniteIndex: number | null = null;
  let nonFiniteIndex: number | null = null;
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i].value;
    if (!Number.isFinite(value)) {
      if (nonFiniteIndex === null) nonFiniteIndex = i;
      continue;
    }
    if (firstFiniteIndex === null) firstFiniteIndex = i;
    lastFiniteIndex = i;
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const detail: Record<string, unknown> = {
    count: samples.length,
    firstTime: first.time,
    firstGap: first.time - currentTime,
    firstValue: first.value,
    lastTime: last.time,
    lastGap: last.time - currentTime,
    lastValue: last.value,
    firstFiniteIndex,
    lastFiniteIndex,
    nonFiniteIndex,
    minValue: minValue === Infinity ? null : minValue,
    maxValue: maxValue === -Infinity ? null : maxValue,
  };
  if (projectionTrace.shouldCaptureSamples()) {
    detail.samples = samples.map((sample) => ({
      time: sample.time,
      gap: sample.time - currentTime,
      value: sample.value,
    }));
  }
  return detail;
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
      recordDriftSample(name, value);
    }
  }
  checkDriftThreshold();
}

/**
 * Live sample tick: advance WASM state to the supplied time, record past
 * values, then optionally manage the projection fork's future buffers.
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
  options: { projectFuture?: boolean } = {},
): Promise<void> {
  const outputs = Object.keys(visStore.expressions);
  const requestedOutputs = ["bar", ...outputs];
  const noUserOutputs = outputs.length === 0;
  const projectFuture = options.projectFuture !== false;

  const halfWindow = settings.windowDuration / 2;
  const futureEdge = timeSeconds + halfWindow + (settings.futureLeadSeconds || 0);

  // Compute the required future sample density (spec §3.1.2).
  const futureDensityHz = futureProjectionSampleRate(settings);
  const maxBoundaryGap = futureBoundaryMaxGapSeconds(futureDensityHz);
  const traceBuffersBefore = import.meta.env.DEV
    ? Object.fromEntries(outputs.map((name) => [
      name,
      futureBufferTraceSummary(name, timeSeconds),
    ]))
    : {};

  // Decide projection mode.
  let needsResetFill = projectFuture && futureInvalidated;
  if (projectFuture && !needsResetFill && !noUserOutputs) {
    for (const name of outputs) {
      const fb = futureBuffers.get(name);
      if (
        !fb ||
        fb.length < 2 ||
        !futureBufferHasNearBoundaryCoverage(fb, timeSeconds, maxBoundaryGap)
      ) {
        needsResetFill = true;
        break;
      }
    }
  }

  // Lever 1 (adaptive quality, spec §1.7/§9.2): under sustained frame
  // pressure, skip steady-state frontier extension. Coverage running out
  // triggers a reset-fill instead.
  const skipProjection =
    !projectFuture ||
    (!needsResetFill && !noUserOutputs && shouldSkipFutureEdgePush());

  // Spec §3.8: frontier coverage with guard band. The frontier is
  // "adequate" when it covers futureEdge + guardBand. Extension is only
  // needed when the frontier falls short of that target.
  const futureEdgeWithGuard = futureEdge + FRONTIER_GUARD_BAND_SECONDS;
  const needsExtension =
    !needsResetFill &&
    !noUserOutputs &&
    !skipProjection &&
    projectionFrontier < futureEdgeWithGuard;

  if (import.meta.env.DEV) {
    projectionTrace.record("sampler-decision", {
      timeSeconds,
      outputs,
      requestedOutputs,
      projectFuture,
      noUserOutputs,
      futureInvalidated,
      needsResetFill,
      skipProjection,
      needsExtension,
      projectionFrontier,
      futureEdge,
      futureEdgeWithGuard,
      futureDensityHz,
      maxBoundaryGap,
      buffersBefore: traceBuffersBefore,
    });
  }

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
    } else if (needsExtension) {
      projMode = PROJECTION_MODE_EXTEND;
      projectEnd = futureEdgeWithGuard;
      origin = projectionFrontier;
      numSamples = futureExtensionSampleCount(
        origin,
        projectEnd,
        futureDensityHz,
        settings.extensionBatchSize,
      );
      modeLabel = "extend";
    } else {
      // Frontier already covers futureEdge + guard band — tick only.
      projMode = PROJECTION_MODE_NONE;
      projectEnd = timeSeconds;
      numSamples = 0;
      origin = timeSeconds;
      modeLabel = "frontier-adequate";
    }
    if (import.meta.env.DEV) perf.count(`sampler-mode-${modeLabel}`);
    if (import.meta.env.DEV) {
      projectionTrace.record("sampler-mode", {
        path: "combined",
        modeLabel,
        projectionMode: projMode,
        timeSeconds,
        projectEnd,
        origin,
        numSamples,
        futureEdge,
        futureEdgeWithGuard,
        projectionFrontierBefore: projectionFrontier,
      });
    }

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
      if (import.meta.env.DEV) {
        projectionTrace.record("sampler-combined-result", {
          modeLabel,
          projectionMode: projMode,
          timeSeconds,
          projectEnd,
          origin,
          numSamples,
          tickValues: Object.fromEntries(combined.tickValues),
          perOutput: Object.fromEntries(outputs.map((name) => [
            name,
            sampleTraceSummary(combined.projectionSamples.get(name), timeSeconds),
          ])),
        });
      }
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
          if (import.meta.env.DEV) {
            projectionTrace.record("sampler-buffer-apply", {
              path: "combined",
              modeLabel,
              output: name,
              action: "reset-fill",
              timeSeconds,
              samples: sampleTraceSummary(samples, timeSeconds),
              bufferAfter: futureBufferTraceSummary(name, timeSeconds),
            });
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
          if (import.meta.env.DEV) {
            projectionTrace.record("sampler-buffer-apply", {
              path: "combined",
              modeLabel,
              output: name,
              action: "extend",
              timeSeconds,
              samples: sampleTraceSummary(samples, timeSeconds),
              bufferAfter: futureBufferTraceSummary(name, timeSeconds),
            });
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
  if (projectFuture && (futureInvalidated || needsResetFill)) {
    if (import.meta.env.DEV) perf.count("sampler-legacy-refill");
    futureInvalidated = false;
    const futureSampleCount = Math.max(
      2,
      Math.ceil((futureEdge - timeSeconds) * futureDensityHz),
    );
    if (import.meta.env.DEV) {
      projectionTrace.record("sampler-mode", {
        path: "legacy",
        modeLabel: "reset-fill",
        timeSeconds,
        projectEnd: futureEdge,
        origin: timeSeconds,
        numSamples: futureSampleCount,
        futureEdge,
        futureEdgeWithGuard,
        projectionFrontierBefore: projectionFrontier,
      });
    }
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
    if (import.meta.env.DEV) {
      projectionTrace.record("sampler-legacy-result", {
        modeLabel: "reset-fill",
        timeSeconds,
        projectEnd: futureEdge,
        numSamples: futureSampleCount,
        perOutput: Object.fromEntries(outputs.map((name) => [
          name,
          sampleTraceSummary(futureResults.get(name), timeSeconds),
        ])),
      });
    }
    for (const [name, samples] of futureResults) {
      const buf = ensureFutureBuffer(name);
      buf.clear();
      for (let i = 0; i < samples.length; i++) {
        if (Number.isFinite(samples[i].value)) {
          buf.push(samples[i].time, samples[i].value);
        }
      }
      if (import.meta.env.DEV) {
        projectionTrace.record("sampler-buffer-apply", {
          path: "legacy",
          modeLabel: "reset-fill",
          output: name,
          action: "reset-fill",
          timeSeconds,
          samples: sampleTraceSummary(samples, timeSeconds),
          bufferAfter: futureBufferTraceSummary(name, timeSeconds),
        });
      }
    }
    projectionFrontier = futureEdge;
    return;
  }

  if (skipProjection) {
    if (import.meta.env.DEV) perf.count("sampler-legacy-skipped");
    if (import.meta.env.DEV) {
      projectionTrace.record("sampler-mode", {
        path: "legacy",
        modeLabel: "skip",
        timeSeconds,
        projectionFrontier,
        futureEdge,
        futureEdgeWithGuard,
      });
    }
    return;
  }

  // Legacy steady-state: frontier adequate → tick only.
  if (!needsExtension) {
    if (import.meta.env.DEV) perf.count("sampler-legacy-frontier-adequate");
    if (import.meta.env.DEV) {
      projectionTrace.record("sampler-mode", {
        path: "legacy",
        modeLabel: "frontier-adequate",
        timeSeconds,
        projectionFrontier,
        futureEdge,
        futureEdgeWithGuard,
      });
    }
    return;
  }

  // Legacy steady-state: push one sample at the far edge.
  if (import.meta.env.DEV) {
    projectionTrace.record("sampler-mode", {
      path: "legacy",
      modeLabel: "edge",
      timeSeconds,
      projectEnd: futureEdge,
      origin: futureEdge,
      numSamples: 1,
      projectionFrontierBefore: projectionFrontier,
      futureEdge,
      futureEdgeWithGuard,
    });
  }
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
  if (import.meta.env.DEV) {
    projectionTrace.record("sampler-legacy-result", {
      modeLabel: "edge",
      timeSeconds,
      projectEnd: futureEdge,
      numSamples: 1,
      perOutput: Object.fromEntries(outputs.map((name) => [
        name,
        sampleTraceSummary(edgeValues.get(name), timeSeconds),
      ])),
    });
  }
  for (const [name, samples] of edgeValues) {
    if (samples.length > 0 && Number.isFinite(samples[0].value)) {
      ensureFutureBuffer(name).push(futureEdge, samples[0].value);
      if (import.meta.env.DEV) {
        projectionTrace.record("sampler-buffer-apply", {
          path: "legacy",
          modeLabel: "edge",
          output: name,
          action: "append-edge",
          timeSeconds,
          samples: sampleTraceSummary(samples, timeSeconds),
          bufferAfter: futureBufferTraceSummary(name, timeSeconds),
        });
      }
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

  updateFutureBufferCapacity(settings);

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
