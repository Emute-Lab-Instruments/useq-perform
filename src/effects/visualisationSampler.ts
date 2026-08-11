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
import type { PastBuffer } from "../lib/PastBuffer.ts";
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
import { codeEvaluated as codeEvaluatedChannel, liveEditValueChanged } from "../contracts/runtimeChannels";
import { recordDriftSample, checkDriftThreshold } from "./driftDetector";
import { serialVisPaletteChangedChannel } from "../contracts/visualisationChannels";
import { addValueChangeListener, removeValueChangeListener } from "./mockControlInputs.ts";
import { hwInputStream } from "../contracts/hardwareChannels.ts";
import {
  OutputClass,
  type ProjectionMode,
  type OutputClassification,
} from "../contracts/runtimePorts";
import {
  planProjection,
  PROJECTION_MODE_EXTEND,
  PROJECTION_MODE_RESET_FILL,
} from "./visualisationProjectionPlan";
import {
  summarizeFutureBuffer,
  summarizeProjectionSamples,
} from "./visualisationProjectionTrace";
import { applyProjectionSamples } from "./visualisationBufferApplication";
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
import {
  clearFutureBuffer,
  configureFutureBufferCapacity,
  destroyVisualisationBuffers,
  ensureFutureBuffer,
  ensurePastBuffer,
  futureBufferFor,
  futureProjectionSampleRate,
} from "./visualisationBuffers.ts";
import {
  DEFAULT_INPUT_EPSILON,
  resolveVisualisationSamplingPolicy,
  projectionSettingsKey,
} from "./visualisationSamplingPolicy.ts";

export {
  getPastBufferSampleRate,
  getRenderData,
  getTemporalSampleRate,
  setPastBufferSampleRate,
} from "./visualisationBuffers.ts";
export type { OutputRenderData } from "./visualisationBuffers.ts";

// ── WASM port ───────────────────────────────────────────────────────

const wasmPort = () => getActiveWasmRuntimePort();
const evalInUseqWasmSilently = (code: string): Promise<string | null> =>
  wasmPort().evalCodeSilently(code);
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

const WASM_ERROR_RESULT = "{error}";

// Guard band for frontier coverage (spec §3.8): expressed in seconds so
// variable rAF cadence doesn't create sawtooth coverage. The frontier is
// considered "adequate" when it reaches futureEdge + guardBand.
export const FRONTIER_GUARD_BAND_SECONDS = 0.5;

const FUTURE_BOUNDARY_GAP_SAMPLE_MULTIPLIER = 4;

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

function inferEvaluatedOutputType(code: string | null | undefined): string | null {
  const match = String(code || "").match(/^\s*\(\s*([ads][1-8])(?:\s|\))/);
  return match?.[1] ?? null;
}

// ── Output classification cache ─────────────────────────────────────
//
// Cached after each code eval. Used for selective invalidation (spec §4.4)
// and projection fast-path decisions. null = classifications unavailable,
// fall back to conservative invalidation.

let cachedClassification: OutputClassification | null = null;

function outputIndexForName(name: string): number {
  if (name.length !== 2) return -1;
  const prefix = name[0];
  const digit = name.charCodeAt(1) - 49; // '1' = 0, '8' = 7
  if (digit < 0 || digit > 7) return -1;
  switch (prefix) {
    case "a": return digit;
    case "d": return 8 + digit;
    case "s": return 16 + digit;
    default: return -1;
  }
}

function getOutputClass(name: string): OutputClass {
  if (!cachedClassification) return OutputClass.Stateful; // conservative
  const idx = outputIndexForName(name);
  if (idx < 0 || idx >= cachedClassification.classes.length) return OutputClass.Stateful;
  return cachedClassification.classes[idx];
}

function getOutputInputMask(name: string): number {
  if (!cachedClassification) return 0xFFFFFFFF; // conservative: assume all inputs
  const idx = outputIndexForName(name);
  if (idx < 0 || idx >= cachedClassification.inputMasks.length) return 0xFFFFFFFF;
  return cachedClassification.inputMasks[idx];
}

async function refreshClassificationCache(): Promise<void> {
  try {
    cachedClassification = await wasmPort().readOutputClassifications();
  } catch {
    cachedClassification = null;
  }
}

// ── Future invalidation & frontier tracking ───────────────────────
//
// Selective invalidation (spec §4.4): input changes only invalidate
// outputs whose dependency mask includes the changed input channel.
// Pure outputs never need fork invalidation on input changes.
// Falls back to conservative (invalidate all) when classifications
// are unavailable.

let futureInvalidated = false;
let projectionFrontier = -Infinity;
let invalidatedFutureOutputs: Set<string> | null = new Set();

function normalizeInvalidatedOutputs(
  exprTypes?: string | Iterable<string> | null,
): Set<string> | null {
  if (!exprTypes) return null;
  const values = typeof exprTypes === "string" ? [exprTypes] : Array.from(exprTypes);
  const normalized = values
    .map((value) => String(value || "").trim())
    .filter((value) => value.length > 0);
  return normalized.length > 0 ? new Set(normalized) : null;
}

export function invalidateFutureProjections(
  exprTypes?: string | Iterable<string> | null,
): void {
  const scopedOutputs = normalizeInvalidatedOutputs(exprTypes);
  const alreadyAllInvalidated = futureInvalidated && invalidatedFutureOutputs === null;
  futureInvalidated = true;
  projectionFrontier = -Infinity;
  if (!scopedOutputs) {
    invalidatedFutureOutputs = null;
  } else if (!alreadyAllInvalidated) {
    if (invalidatedFutureOutputs === null) invalidatedFutureOutputs = new Set();
    for (const name of scopedOutputs) invalidatedFutureOutputs.add(name);
  }
  if (import.meta.env.DEV) {
    projectionTrace.record("sampler-invalidate", {
      projectionFrontier,
      expressionCount: Object.keys(visStore.expressions).length,
      outputs: scopedOutputs ? Array.from(scopedOutputs) : "all",
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

function applyResetFillSamples(
  name: string,
  samples: VisSample[] | undefined,
  resetApplyOutputs: Set<string> | null,
  currentTime: number,
  path: "combined" | "legacy",
  modeLabel: string,
): number {
  if (!samples) return projectionFrontier;

  const shouldResetBuffer =
    resetApplyOutputs === null || resetApplyOutputs.has(name);
  const buf = ensureFutureBuffer(name);
  const appendAfterTime = shouldResetBuffer ? -Infinity : buf.newestTime;
  const application = applyProjectionSamples(buf, samples, {
    reset: shouldResetBuffer,
  });
  const actualFrontier = Math.max(projectionFrontier, application.frontier);

  if (import.meta.env.DEV) {
    projectionTrace.record("sampler-buffer-apply", {
      path,
      modeLabel,
      output: name,
      action: shouldResetBuffer ? "reset-fill" : "preserve-and-extend",
      timeSeconds: currentTime,
      appendAfterTime,
      samples: sampleTraceSummary(samples, currentTime),
      bufferAfter: futureBufferTraceSummary(name, currentTime),
    });
  }

  return actualFrontier;
}

function futureBufferTraceSummary(
  name: string,
  currentTime: number,
): Record<string, unknown> {
  return summarizeFutureBuffer(futureBufferFor(name), currentTime);
}

function sampleTraceSummary(
  samples: VisSample[] | undefined,
  currentTime: number,
): Record<string, unknown> {
  return summarizeProjectionSamples(samples, currentTime);
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
  options: { projectFuture?: boolean; isCurrent?: () => boolean } = {},
): Promise<void> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!isCurrent()) return;
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

  // Decide projection mode without performing runtime or buffer work.
  let resetApplyOutputs: Set<string> | null =
    futureInvalidated && invalidatedFutureOutputs !== null
      ? new Set(outputs.filter((name) => invalidatedFutureOutputs?.has(name)))
      : null;
  const allOutputsCoverBoundary = noUserOutputs || outputs.every((name) => {
    const buffer = futureBufferFor(name);
    return !!buffer &&
      buffer.length >= 2 &&
      futureBufferHasNearBoundaryCoverage(
        buffer,
        timeSeconds,
        maxBoundaryGap,
      );
  });
  const plan = planProjection({
    timeSeconds,
    futureEdge,
    halfWindow,
    guardBandSeconds: FRONTIER_GUARD_BAND_SECONDS,
    projectFuture,
    noUserOutputs,
    futureInvalidated,
    allOutputsCoverBoundary,
    adaptiveSkipRequested: shouldSkipFutureEdgePush(),
    projectionFrontier,
    futureDensityHz,
    extensionBatchSize: settings.extensionBatchSize,
  });
  if (plan.boundaryForcedReset) resetApplyOutputs = null;
  const {
    needsResetFill,
    skipProjection,
    needsExtension,
    futureEdgeWithGuard,
    visibleFutureEdgeWithGuard,
  } = plan;

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
      visibleFutureEdgeWithGuard,
      futureDensityHz,
      maxBoundaryGap,
      resetApplyOutputs: resetApplyOutputs ? Array.from(resetApplyOutputs) : "all",
      buffersBefore: traceBuffersBefore,
    });
  }

  // ── Combined path (projection-fork ABI) ──────────────────────────
  const portCaps = wasmPort().capabilities();
  if (portCaps.supportsTickAndProject) {
    const {
      mode: projMode,
      modeLabel,
      projectEnd,
      origin,
      sampleCount: numSamples,
    } = plan.request;
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
    if (!isCurrent()) return;

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
        invalidatedFutureOutputs = new Set();
        let actualFrontier = projectionFrontier;
        for (const name of outputs) {
          const samples = combined.projectionSamples.get(name);
          actualFrontier = Math.max(
            actualFrontier,
            applyResetFillSamples(
              name,
              samples,
              resetApplyOutputs,
              timeSeconds,
              "combined",
              modeLabel,
            ),
          );
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
          const application = applyProjectionSamples(buf, samples, {
            reset: false,
          });
          actualFrontier = Math.max(actualFrontier, application.frontier);
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
  if (!isCurrent()) return;

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
    invalidatedFutureOutputs = new Set();
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
    if (!isCurrent()) return;
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
    // M2 fix: advance the frontier only to the actual max time pushed,
    // not the requested futureEdge. WASM may truncate the trace early
    // (non-finite value, §6.4); claiming we reached futureEdge would
    // suppress the re-extension that should refill the gap. Mirrors the
    // combined-path handling above.
    let actualFrontier = projectionFrontier;
    for (const [name, samples] of futureResults) {
      actualFrontier = Math.max(
        actualFrontier,
        applyResetFillSamples(
          name,
          samples,
          resetApplyOutputs,
          timeSeconds,
          "legacy",
          "reset-fill",
        ),
      );
    }
    projectionFrontier = actualFrontier;
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
  if (!isCurrent()) return;
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
    destroyVisualisationBuffers(exprType);
    setLastChangeKind("unregister", { exprType });
    return;
  }

  await evalInUseqWasmSilently(trimmed);
  await refreshClassificationCache();

  ensurePastBuffer(exprType);
  clearFutureBuffer(exprType);

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
  invalidateFutureProjections(exprType);
  setLastChangeKind("register", { exprType });
}

export function unregisterVisualisation(exprType: string): void {
  removeExpression(exprType);
  destroyVisualisationBuffers(exprType);
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
  let expressionChanged = false;
  try {
    const result = await evalInUseqWasmSilently(trimmed);
    if (isWasmErrorResult(result)) {
      throw new Error(`uSEQ returned ${WASM_ERROR_RESULT}`);
    }
    nextExpressionText = trimmed;
    expressionChanged = nextExpressionText !== expr.expressionText;
    await refreshClassificationCache();
  } catch (error) {
    dbg(
      `visualisationSampler: failed to update interpreter for ${exprType}: ${error}`,
    );
    try {
      const restoreResult = await evalInUseqWasmSilently(expr.expressionText);
      if (isWasmErrorResult(restoreResult)) {
        throw new Error(`uSEQ returned ${WASM_ERROR_RESULT}`);
      }
      await refreshClassificationCache();
    } catch (restoreError) {
      dbg(
        `visualisationSampler: failed to restore last good expression for ${exprType}: ${restoreError}`,
      );
    }
  }

  if (expressionChanged) {
    // Past buffer is preserved — this output's future will re-project on
    // the next future sample without trashing unrelated future buffers.
    clearFutureBuffer(exprType);
    invalidateFutureProjections(exprType);
  }

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
  exprType: string | null = null,
): void {
  invalidateFutureProjections(exprType);
  setLastChangeKind("data");
  // Refresh classification cache asynchronously after each eval.
  // The cache will be ready by the next frame's tickAndProject call.
  refreshClassificationCache();
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
  const settings = resolveVisualisationSamplingPolicy(visual);
  updateSettings(settings);

  configureFutureBufferCapacity(settings);

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

// Track subscription handles for HMR cleanup — without this, hot-module
// reloads stack phantom listeners referencing stale module-level state.
const _unsubs: (() => void)[] = [];
const lastHwInputValues = new Map<number, number>();
let lastProjectionSettingsKey: string | null = null;

if (typeof window !== "undefined") {
  setTimeout(() => {
    try {
      const initialSettings = loadAndApplySettings();
      lastProjectionSettingsKey = projectionSettingsKey(initialSettings);

      const unsubSettings = subscribeAppSettings(() => {
        const nextSettings = loadAndApplySettings();
        const nextKey = projectionSettingsKey(nextSettings);
        if (
          lastProjectionSettingsKey !== null &&
          nextKey !== lastProjectionSettingsKey
        ) {
          invalidateFutureProjections();
        }
        lastProjectionSettingsKey = nextKey;
        setLastChangeKind("settings");
      });
      _unsubs.push(unsubSettings);
    } catch {
      // TDZ — appSettingsRepository not ready.
    }
  }, 0);

  _unsubs.push(
    codeEvaluatedChannel.subscribe((detail) => {
      notifyExpressionEvaluated(inferEvaluatedOutputType(detail?.code));
    }),
  );

  // External input changes beyond inputEpsilon invalidate the
  // projection fork (spec §4.4). Selective: only invalidate when at
  // least one active output is input-dependent or stateful. Pure
  // outputs are unaffected by input changes.
  const mockControlListener = (_name: string, newValue: number, oldValue: number) => {
    const epsilon = visStore.settings.inputEpsilon ?? DEFAULT_INPUT_EPSILON;
    if (Math.abs(newValue - oldValue) <= epsilon) return;

    const outputs = Object.keys(visStore.expressions);
    const affectedOutputs = outputs.filter((name) => {
      const cls = getOutputClass(name);
      return cls === OutputClass.InputDep || cls === OutputClass.Stateful;
    });

    if (affectedOutputs.length > 0) {
      invalidateFutureProjections(affectedOutputs);
      setLastChangeKind("data");
    }
  };
  addValueChangeListener(mockControlListener);

  // Hardware input stream values: forward to WASM and selectively
  // invalidate projections for outputs that depend on the changed input.
  _unsubs.push(
    hwInputStream.subscribe(({ hwInputIndex, value }) => {
      const numericIndex = Number(hwInputIndex);
      const numericValue = Number(value);
      if (!Number.isInteger(numericIndex) || !Number.isFinite(numericValue)) {
        return;
      }

      const epsilon = visStore.settings.inputEpsilon ?? DEFAULT_INPUT_EPSILON;
      const previousValue = lastHwInputValues.get(numericIndex) ?? 0;
      if (Math.abs(numericValue - previousValue) <= epsilon) {
        return;
      }
      lastHwInputValues.set(numericIndex, numericValue);

      wasmPort().setHwInputValue(numericIndex, numericValue).catch(() => {});

      const outputs = Object.keys(visStore.expressions);
      const affectedOutputs = outputs.filter((name) => {
        const mask = getOutputInputMask(name);
        return (mask & (1 << numericIndex)) !== 0;
      });
      if (affectedOutputs.length > 0) {
        invalidateFutureProjections(affectedOutputs);
        setLastChangeKind("data");
      }
    }),
  );

  // Live-edit value changes invalidate the projection fork (spec §3.7).
  _unsubs.push(
    liveEditValueChanged.subscribe(() => {
      invalidateFutureProjections();
      setLastChangeKind("data");
    }),
  );

  _unsubs.push(
    serialVisPaletteChangedChannel.subscribe((detail) => {
      if (Array.isArray(detail?.palette)) {
        setVisPalette(detail.palette);
      }
      refreshAllColors(visStore.settings);
      setLastChangeKind("palette");
    }),
  );

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      for (const unsub of _unsubs) unsub();
      _unsubs.length = 0;
      removeValueChangeListener(mockControlListener);
    });
  }
}
