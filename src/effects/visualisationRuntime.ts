/**
 * Visualisation Runtime
 *
 * Single owner of the visualisation render+sample lifecycle.
 *
 * Responsibilities:
 *   1. One rAF loop drives both sampling and rendering.
 *   2. Tracks "current time" for browser-local mode (rAF tick) and
 *      for hardware mode (`notifyExternalTimeUpdate`).
 *   3. Coalesces sampling: at most one tick-and-project cycle is in
 *      flight at a time; newer times supersede pending ones.
 *   4. Delegates to `visualisationSampler.tickAndProject()` for the
 *      actual WASM work (tick → record past → project future).
 *
 * Public API:
 *   - startVisualisationRuntime / stopVisualisationRuntime
 *   - setLocalTimeMode / resetLocalTime / isLocalTimeActive / getLocalTime
 *   - notifyExternalTimeUpdate (hardware path)
 *   - requestVisualisationRender / pauseVisualisationRender
 */

import { dbg } from "../lib/debug.ts";
import { perf } from "../lib/perfTrace.ts";
import {
  setLastChangeKind,
  updateTime,
  visStore,
} from "../utils/visualisationStore.ts";
import {
  tickAndProject,
  refreshBarValue,
  syncInterpreterTime,
} from "./visualisationSampler.ts";
import { getActiveWasmRuntimePort } from "../runtime/activeWasmRuntimePort.ts";
import { refreshOutputHealth } from "../utils/outputHealthStore.ts";

/**
 * Render hook supplied by a UI adapter — `effects/` is forbidden from
 * importing `ui/` directly, so the rendering panel registers itself here.
 */
export interface VisualisationRenderHook {
  paint(): void;
  isVisible(): boolean;
}

let renderHook: VisualisationRenderHook | null = null;

export function registerVisualisationRenderHook(
  hook: VisualisationRenderHook | null,
): void {
  renderHook = hook;
}

// ── Tunables ─────────────────────────────────────────────────────────

const TARGET_TICK_MS = 1000 / 30;
const DIAG_POLL_INTERVAL = 6;

// ── Tick state ─────────────────────────────────────────────────���─────

let running = false;
let frameId: number | null = null;
let lastTickMs = 0;
let frameCount = 0;

// ── Local time mode ─────────────────────────────────────────────────

let localTimeActive = false;
let localResetMs: number | null = null;
let localElapsedSeconds = 0;

// ── Sampling coalescing ─────────────────────────────────────────────

let pendingSampleTime: number | null = null;
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
      localResetMs = performance.now();
      localElapsedSeconds = 0;
    } else {
      localResetMs = performance.now() - localElapsedSeconds * 1000;
    }
    if (running) requestSampleAt(localElapsedSeconds);
  }
}

export function resetLocalTime(): void {
  localResetMs = localTimeActive ? performance.now() : null;
  localElapsedSeconds = 0;
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
  requestSampleAt(numeric);
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

  const now = performance.now();
  if (now - lastTickMs < TARGET_TICK_MS) return;
  lastTickMs = now;

  perf.begin("frame-tick");
  frameCount++;

  if (localTimeActive) {
    localElapsedSeconds = (now - (localResetMs ?? 0)) / 1000;
    updateTime(localElapsedSeconds);
    setLastChangeKind("time", {
      currentTimeSeconds: localElapsedSeconds,
      displayTimeSeconds: localElapsedSeconds,
    });
    requestSampleAt(localElapsedSeconds);
  }

  if (frameCount % DIAG_POLL_INTERVAL === 0 && !diagPollInFlight) {
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

  void drainSamplingQueue();

  if (renderRequested) {
    renderFrame();
  }

  perf.end("frame-tick");
}

function scheduleImmediateRender(): void {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    if (renderRequested) renderFrame();
  });
}

function renderFrame(): void {
  if (!renderHook) return;
  perf.begin("render-frame");
  if (!renderHook.isVisible()) {
    perf.end("render-frame");
    return;
  }
  renderHook.paint();
  perf.end("render-frame");
}

// ── Internal: sampling ──────────────────────────────────────────────

function requestSampleAt(time: number): void {
  pendingSampleTime = time;
}

let inFlightDrainPromise: Promise<void> | null = null;

async function drainSamplingQueue(): Promise<void> {
  if (samplingInFlight) {
    if (inFlightDrainPromise) await inFlightDrainPromise;
    return;
  }
  if (pendingSampleTime === null) return;
  samplingInFlight = true;
  inFlightDrainPromise = (async () => {
    try {
      while (pendingSampleTime !== null) {
        const t = pendingSampleTime;
        pendingSampleTime = null;
        await runSample(t);
      }
    } finally {
      samplingInFlight = false;
      inFlightDrainPromise = null;
    }
  })();
  await inFlightDrainPromise;
}

async function runSample(timeSeconds: number): Promise<void> {
  perf.begin("resample-total");
  try {
    perf.begin("wasm-update-time");
    try {
      await syncInterpreterTime(timeSeconds);
    } catch (error) {
      dbg(`visualisationRuntime: failed to sync interpreter time: ${error}`);
      perf.end("wasm-update-time");
      return;
    }
    perf.end("wasm-update-time");

    perf.begin("refresh-bar");
    await refreshBarValue(timeSeconds);
    perf.end("refresh-bar");

    const expressions = visStore.expressions;
    if (Object.keys(expressions).length > 0) {
      const settings = visStore.settings;
      perf.begin("tick-and-project");
      await tickAndProject(timeSeconds, settings);
      perf.end("tick-and-project");
    }

    setLastChangeKind("data");
  } finally {
    perf.end("resample-total");
  }
}

// ── Test seam ──────────────────────────────────────────────────────��

export async function _drainForTests(): Promise<void> {
  await drainSamplingQueue();
}

export function _resetForTests(): void {
  stopVisualisationRuntime();
  localTimeActive = false;
  localResetMs = null;
  localElapsedSeconds = 0;
  pendingSampleTime = null;
  samplingInFlight = false;
  diagPollInFlight = false;
  renderRequested = false;
  frameCount = 0;
  lastTickMs = 0;
}
