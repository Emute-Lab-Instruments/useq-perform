/**
 * Visualisation Runtime
 *
 * Single owner of the visualisation render+sample lifecycle.
 *
 * Responsibilities:
 *   1. One rAF loop drives rendering and queues any live samples needed
 *      to catch up to the configured temporal sample rate.
 *   2. Tracks "current time" for browser-local mode (rAF tick) and
 *      for hardware mode (`notifyExternalTimeUpdate`).
 *   3. Serializes sampling: at most one tick-and-project cycle is in
 *      flight at a time. Browser-local mode may queue multiple
 *      intermediate tick times per frame; hardware/external time updates
 *      coalesce to the newest time.
 *   4. Delegates to `visualisationSampler.tickAndProject()` for the
 *      actual WASM work (tick → record past → project future).
 *
 * Public API:
 *   - startVisualisationRuntime / stopVisualisationRuntime
 *   - setLocalTimeMode / resetLocalTime / isLocalTimeActive / getLocalTime
 *   - notifyExternalTimeUpdate (hardware path)
 *   - requestVisualisationRender / pauseVisualisationRender
 *   - setVisualisationNowSource (deterministic clock seam — see below)
 */

import { dbg } from "../lib/debug.ts";
import { perf } from "../lib/perfTrace.ts";
import {
  setLastChangeKind,
  updateTime,
  visStore,
} from "../utils/visualisationStore.ts";
import {
  getTemporalSampleRate,
  tickAndProject,
  syncInterpreterTime,
} from "./visualisationSampler.ts";
import { getActiveWasmRuntimePort } from "../runtime/activeWasmRuntimePort.ts";
import { refreshOutputHealth } from "../utils/outputHealthStore.ts";
import { recordTickElapsed } from "./adaptiveQuality.ts";
import { projectionTrace } from "../lib/projectionTrace.ts";
import { shouldAdvanceLocalTime } from "../audio/audioClockPolicy.ts";
import { shouldUseWasmShadow } from "../runtime/runtimeCompatibility.ts";

/**
 * Render hook supplied by a UI adapter — `effects/` is forbidden from
 * importing `ui/` directly, so the rendering panel registers itself here.
 */
export interface VisualisationRenderHook {
  paint(): void;
  afterPaint?(): void;
  isVisible(): boolean;
}

let renderHook: VisualisationRenderHook | null = null;

export function registerVisualisationRenderHook(
  hook: VisualisationRenderHook | null,
): void {
  renderHook = hook;
}

// ── Tunables ─────────────────────────────────────────────────────────

const DIAG_POLL_INTERVAL = 6;
const HARDWARE_PROJECTION_INTERVAL = 6;
const MAX_LOCAL_SAMPLES_PER_FRAME = 64;
const SAMPLE_TIME_EPSILON = 1e-6;

// ── Tick state ─────────────────────────────────────────────────���─────

let running = false;
let frameId: number | null = null;
let lastTickMs = 0;
let frameCount = 0;

// ── Local time mode ─────────────────────────────────────────────────

let localTimeActive = false;
let localResetMs: number | null = null;
let localElapsedSeconds = 0;
let lastLocalSampleTime: number | null = null;
// Wall-clock sample time of the most recent *completed* WASM tick
// (i.e. dequeued and run, not just queued). Used by
// `requestLocalSamplesThrough` to detect drain starvation: when
// completion falls more than one frame's worth of intervals behind the
// current time, we stop queueing per-interval catch-up samples and
// instead enqueue a single sample-with-projection. That caps per-frame
// add-rate at 1, letting the queue (and the projection at its back)
// drain rather than grow unboundedly.
let lastCompletedSampleTime: number | null = null;

// ── Deterministic clock seam (e2e axe item A1) ──────────────────────
//
// Every ModuLisp *local-time* read in this module goes through this one
// time-source function. The default is real `performance.now`, so
// production behaviour is unchanged. Tests may swap in a frozen/stepped
// source via `setVisualisationNowSource`; the devmode browser-eval
// surface (`src/runtime/browserEvalSurface.ts`) builds its
// freezeClock/stepClock/resumeClock hooks on top of exactly this
// setter. The seam is deliberately a single function so deterministic
// time cannot diverge from production timing semantics — every
// local-time consumer (tick advance, mode re-anchor, reset) shares it.
//
// Scope decisions (normative for the seam):
//   - The seam claims ONLY the rAF-local timeline. Frame-pressure
//     telemetry (`recordTickElapsed`) stays on real `performance.now`
//     because it measures actual render load, not ModuLisp time —
//     freezing it would make adaptive quality hallucinate 0ms frames
//     while frozen and one giant frame on resume.
//   - When the running synthesis engine owns time (VAL-ENGINE-002), the
//     local-time branch in `tick` is skipped entirely and the seam is
//     inert; the hook layer refuses to freeze/step in that state.

export type VisualisationNowSource = () => number;

const defaultNowSource: VisualisationNowSource = () => performance.now();
let nowSource: VisualisationNowSource = defaultNowSource;

function nowMs(): number {
  return nowSource();
}

/**
 * Install (or, with `null`, restore the default) local-time source.
 *
 * Swapping sources re-anchors `localResetMs` so the derived elapsed
 * time (`now - localResetMs`) is identical under the old and new
 * sources at the moment of the swap. This means resuming real time
 * after a freeze never jumps: wall-clock time that passed while frozen
 * is invisible to ModuLisp local time.
 */
export function setVisualisationNowSource(
  source: VisualisationNowSource | null,
): void {
  const previousNow = nowMs();
  nowSource = source ?? defaultNowSource;
  if (localResetMs !== null) {
    localResetMs = nowMs() - (previousNow - localResetMs);
  }
}

// ── Sampling coalescing ─────────────────────────────────────────────

interface SampleRequest {
  timeSeconds: number;
  projectFuture: boolean;
}

const sampleQueue: SampleRequest[] = [];
let samplingInFlight = false;

// ── Diagnostic poll coalescing ──────────────────────────────────────
//
// Diagnostics are read via the active WASM runtime port, which is
// async (the worker port crosses postMessage). Keep at most one
// in-flight read at a time and skip starting another while one is
// pending — a stale frame is fine; we re-poll on the next interval.
let diagPollInFlight = false;

// ── Render gating ───────────────────────────────────────────────────

let renderRequested = false;

// ── Public API ──────────────────────────────────────────────────────

export function startVisualisationRuntime(): void {
  if (running || typeof window === "undefined") return;
  running = true;
  lastTickMs = 0;
  scheduleNextTick();
}

export function stopVisualisationRuntime(): void {
  if (!running) return;
  running = false;
  if (frameId !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(frameId);
    frameId = null;
  }
}

export function setLocalTimeMode(active: boolean): void {
  if (active === localTimeActive) return;
  localTimeActive = active;
  if (active) {
    if (localResetMs === null) {
      localResetMs = nowMs();
      localElapsedSeconds = 0;
    } else {
      localResetMs = nowMs() - localElapsedSeconds * 1000;
    }
    lastLocalSampleTime = null;
    lastCompletedSampleTime = null;
    if (running) requestLocalSamplesThrough(localElapsedSeconds);
  }
}

export function resetLocalTime(): void {
  localResetMs = localTimeActive ? nowMs() : null;
  localElapsedSeconds = 0;
  lastLocalSampleTime = null;
  lastCompletedSampleTime = null;
  // transport §1.5: Stop resets the clock — project t=0 into the vis store
  // even while the clock is inactive, otherwise the progress display stays
  // frozen at its last value and Stop is indistinguishable from Pause.
  updateTime(0);
  setLastChangeKind("time", {
    currentTimeSeconds: 0,
    displayTimeSeconds: 0,
  });
  if (running) requestSampleAt(0, { replace: true, projectFuture: true });
}

export function isLocalTimeActive(): boolean {
  return localTimeActive;
}

export function getLocalTime(): number {
  return localElapsedSeconds;
}

export function notifyExternalTimeUpdate(time: number): void {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return;
  updateTime(numeric);
  setLastChangeKind("time", {
    currentTimeSeconds: numeric,
    displayTimeSeconds: numeric,
  });
  if (!shouldUseWasmShadow()) {
    sampleQueue.length = 0;
    return;
  }
  requestSampleAt(numeric, { replace: true, projectFuture: false });
  void drainSamplingQueue();
}

export function requestVisualisationRender(): void {
  renderRequested = true;
  if (!running) startVisualisationRuntime();
  scheduleImmediateRender();
}

export function pauseVisualisationRender(): void {
  renderRequested = false;
}

/**
 * Force the next sample to recompute. Kept for API compat with callers
 * that used the old sampling-window cache invalidation.
 */
export function invalidateSamplingCache(): void {
  // No-op — tick-and-project runs unconditionally each frame.
}

// ── Internal: rAF loop ──────────────────────────────────────────────

function scheduleNextTick(): void {
  if (!running || typeof window === "undefined") return;
  frameId = window.requestAnimationFrame(tick);
}

function tick(): void {
  if (!running) return;
  scheduleNextTick();

  // Frame-pressure telemetry deliberately bypasses the deterministic
  // clock seam: it measures the realised wall-clock frame interval
  // (actual render load), which stays true even while ModuLisp local
  // time is frozen by a test. We measure *between* committed ticks
  // before updating `lastTickMs` so we have access to the previous
  // committed timestamp. Skip the very first committed tick (when
  // `lastTickMs` is 0 from startup).
  const wallNow = performance.now();
  if (lastTickMs > 0) {
    recordTickElapsed(wallNow - lastTickMs);
  }
  lastTickMs = wallNow;

  if (import.meta.env.DEV) perf.begin("frame-tick");
  frameCount++;

  if (localTimeActive && shouldAdvanceLocalTime()) {
    // VAL-ENGINE-002: while the synthesis engine is running, audio frames
    // own ModuLisp time. A suspended engine has no advancing audio frame,
    // so rAF continues to drive the local visualisation clock until sound
    // is actually running. Outside this branch rAF still paints and polls
    // diagnostics, but it never advances a second live timeline while
    // `shouldAdvanceLocalTime()` reports that audio owns the clock.
    //
    // Local time reads through the deterministic clock seam (`nowMs`),
    // so a frozen test clock holds this branch still while the rAF loop
    // keeps painting and polling, and a stepped clock drives it through
    // this exact production path.
    localElapsedSeconds = (nowMs() - (localResetMs ?? 0)) / 1000;
    updateTime(localElapsedSeconds);
    setLastChangeKind("time", {
      currentTimeSeconds: localElapsedSeconds,
      displayTimeSeconds: localElapsedSeconds,
    });
    requestLocalSamplesThrough(localElapsedSeconds);
  }

  const wasmObservationEnabled = shouldUseWasmShadow();

  if (
    wasmObservationEnabled &&
    frameCount % DIAG_POLL_INTERVAL === 0 &&
    !diagPollInFlight
  ) {
    diagPollInFlight = true;
    // Fire-and-forget: don't block the rAF tick on the port read. The
    // worker port crosses postMessage, so the result lands a frame or
    // two later — that's acceptable for output health UI which polls
    // every 6 frames anyway.
    getActiveWasmRuntimePort()
      .readActiveDiagnostics()
      .then((activeDiags) => {
        refreshOutputHealth(activeDiags);
      })
      .catch((error: unknown) => {
        dbg(`visualisationRuntime: failed to read active diagnostics: ${error}`);
      })
      .finally(() => {
        diagPollInFlight = false;
      });
  }

  if (
    wasmObservationEnabled &&
    !localTimeActive &&
    frameCount % HARDWARE_PROJECTION_INTERVAL === 0
  ) {
    const t = visStore.currentTime;
    if (Number.isFinite(t) && t > 0) {
      requestSampleAt(t, { replace: false, projectFuture: true });
    }
  }

  if (wasmObservationEnabled) void drainSamplingQueue();

  if (renderRequested) {
    renderFrame();
  }

  if (import.meta.env.DEV) perf.end("frame-tick");
}

function scheduleImmediateRender(): void {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    if (renderRequested) renderFrame();
  });
}

function renderFrame(): void {
  if (!renderHook) return;
  if (import.meta.env.DEV) perf.begin("render-frame");
  if (!renderHook.isVisible()) {
    if (import.meta.env.DEV) perf.end("render-frame");
    return;
  }
  renderHook.paint();
  renderHook.afterPaint?.();
  if (import.meta.env.DEV) perf.end("render-frame");
}

// ── Internal: sampling ──────────────────────────────────────────────

function requestSampleAt(
  time: number,
  options: { replace?: boolean; projectFuture?: boolean } = {},
): void {
  const queueBefore = sampleQueue.map((request) => ({
    timeSeconds: request.timeSeconds,
    projectFuture: request.projectFuture,
  }));
  const requestedProjectFuture = options.projectFuture !== false;
  const preserveQueuedProjection =
    options.replace === true && sampleQueue.some((request) => request.projectFuture);
  const request: SampleRequest = {
    timeSeconds: time,
    projectFuture: requestedProjectFuture || preserveQueuedProjection,
  };
  if (options.replace) {
    sampleQueue.length = 0;
    sampleQueue.push(request);
    if (import.meta.env.DEV) {
      projectionTrace.record("runtime-sample-request", {
        time,
        replace: true,
        requestedProjectFuture,
        preserveQueuedProjection,
        queuedProjectFuture: request.projectFuture,
        samplingInFlight,
        queueBefore,
        queueAfter: sampleQueue.map((queued) => ({
          timeSeconds: queued.timeSeconds,
          projectFuture: queued.projectFuture,
        })),
      });
    }
    return;
  }
  if (request.projectFuture) {
    for (const queued of sampleQueue) queued.projectFuture = false;
  }
  sampleQueue.push(request);
  if (import.meta.env.DEV) {
    projectionTrace.record("runtime-sample-request", {
      time,
      replace: false,
      requestedProjectFuture,
      preserveQueuedProjection,
      queuedProjectFuture: request.projectFuture,
      samplingInFlight,
      queueBefore,
      queueAfter: sampleQueue.map((queued) => ({
        timeSeconds: queued.timeSeconds,
        projectFuture: queued.projectFuture,
      })),
    });
  }
}

function requestLocalSamplesThrough(currentTimeSeconds: number): void {
  const targetHz = getTemporalSampleRate();
  if (!Number.isFinite(targetHz) || targetHz <= 0) {
    requestSampleAt(currentTimeSeconds, { projectFuture: true });
    lastLocalSampleTime = currentTimeSeconds;
    return;
  }

  const intervalSeconds = 1 / targetHz;
  // Drain starvation: if WASM completion has fallen more than a frame's
  // worth of intervals behind, skip catch-up. Adding more per-interval
  // samples while the queue is starved would push the projection
  // request (always at the back) further out of reach.
  const completionBehind =
    lastCompletedSampleTime !== null &&
    currentTimeSeconds - lastCompletedSampleTime >
      intervalSeconds * MAX_LOCAL_SAMPLES_PER_FRAME;
  if (
    lastLocalSampleTime === null ||
    currentTimeSeconds <= lastLocalSampleTime ||
    completionBehind ||
    currentTimeSeconds - lastLocalSampleTime >
      intervalSeconds * MAX_LOCAL_SAMPLES_PER_FRAME
  ) {
    requestSampleAt(currentTimeSeconds, { projectFuture: true });
    lastLocalSampleTime = currentTimeSeconds;
    return;
  }

  let queued = 0;
  let nextTime = lastLocalSampleTime + intervalSeconds;
  for (
    ;
    nextTime <= currentTimeSeconds + SAMPLE_TIME_EPSILON &&
    queued < MAX_LOCAL_SAMPLES_PER_FRAME;
    nextTime += intervalSeconds
  ) {
    requestSampleAt(nextTime, { projectFuture: false });
    lastLocalSampleTime = nextTime;
    queued++;
  }

  if (queued > 0) {
    for (const request of sampleQueue) request.projectFuture = false;
    sampleQueue[sampleQueue.length - 1].projectFuture = true;
  }
}

let inFlightDrainPromise: Promise<void> | null = null;

async function drainSamplingQueue(): Promise<void> {
  if (samplingInFlight) {
    if (inFlightDrainPromise) await inFlightDrainPromise;
    return;
  }
  if (sampleQueue.length === 0) return;
  samplingInFlight = true;
  inFlightDrainPromise = (async () => {
    try {
      while (sampleQueue.length > 0) {
        const request = sampleQueue.shift()!;
        await runSample(request.timeSeconds, request.projectFuture);
      }
    } finally {
      samplingInFlight = false;
      inFlightDrainPromise = null;
    }
  })();
  await inFlightDrainPromise;
}

async function runSample(
  timeSeconds: number,
  projectFuture: boolean,
): Promise<void> {
  if (import.meta.env.DEV) {
    projectionTrace.record("runtime-sample-run", {
      timeSeconds,
      projectFuture,
      queueLength: sampleQueue.length,
    });
  }
  if (import.meta.env.DEV) perf.begin("resample-total");
  try {
    if (import.meta.env.DEV) perf.begin("wasm-update-time");
    try {
      await syncInterpreterTime(timeSeconds);
    } catch (error) {
      dbg(`visualisationRuntime: failed to sync interpreter time: ${error}`);
      if (import.meta.env.DEV) perf.end("wasm-update-time");
      return;
    }
    if (import.meta.env.DEV) perf.end("wasm-update-time");

    // tick-and-project also samples `bar` from the same batch; run it
    // unconditionally so the bar value stays current even when no
    // user expressions are registered.
    const settings = visStore.settings;
    if (import.meta.env.DEV) perf.begin("tick-and-project");
    await tickAndProject(timeSeconds, settings, { projectFuture });
    if (import.meta.env.DEV) perf.end("tick-and-project");
    lastCompletedSampleTime = timeSeconds;

    setLastChangeKind("data");
  } finally {
    if (import.meta.env.DEV) perf.end("resample-total");
  }
}

// ── Test seam ──────────────────────────────────────────────────────��

export async function _drainForTests(): Promise<void> {
  await drainSamplingQueue();
}

export function _resetForTests(): void {
  stopVisualisationRuntime();
  nowSource = defaultNowSource;
  localTimeActive = false;
  localResetMs = null;
  localElapsedSeconds = 0;
  lastLocalSampleTime = null;
  lastCompletedSampleTime = null;
  sampleQueue.length = 0;
  samplingInFlight = false;
  diagPollInFlight = false;
  renderRequested = false;
  frameCount = 0;
  lastTickMs = 0;
}
