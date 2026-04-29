/**
 * Visualisation Runtime
 *
 * Single owner of the visualisation render+sample lifecycle.  Replaces the
 * three-way split between `localClock`, `visualisationSampler`, and the
 * self-scheduling rAF inside `serialVis`.
 *
 * Responsibilities:
 *   1. One rAF loop drives both sampling and rendering. No other module
 *      should call `requestAnimationFrame` for vis purposes.
 *   2. Tracks "current time" for browser-local mode (rAF tick advances it),
 *      and for hardware mode (`notifyExternalTimeUpdate` accepts time
 *      values from `stream-parser`).
 *   3. Coalesces sampling work: at most one WASM sample is in flight at a
 *      time; if a newer time arrives while one is running, the runtime
 *      samples the latest pending time once the current run completes.
 *   4. Skips redundant batch work when the snapped sampling window hasn't
 *      moved across consecutive ticks (window-key cache).
 *
 * The hand-rolled `samplingSequence` / `lastRequestedSamplingWindowKey`
 * / `lastCompletedSamplingWindowKey` / `samplingInFlight` defenses that
 * used to live across the split modules are replaced by the single
 * pending-time slot + in-flight flag below.
 *
 * Public API:
 *   - startVisualisationRuntime / stopVisualisationRuntime
 *   - setLocalTimeMode / resetLocalTime / isLocalTimeActive / getLocalTime
 *   - notifyExternalTimeUpdate (hardware path)
 *   - requestVisualisationRender / pauseVisualisationRender (panel show/hide)
 */

import { dbg } from "../lib/debug.ts";
import { perf } from "../lib/perfTrace.ts";
import {
  setLastChangeKind,
  updateTime,
  visStore,
} from "../utils/visualisationStore.ts";
import {
  computeSamplingWindow,
  rebuildAllExpressions,
  refreshBarValue,
  samplingWindowKey,
  syncInterpreterTime,
} from "./visualisationSampler.ts";
import { readActiveDiagnostics } from "../runtime/wasmInterpreter.ts";
import { refreshOutputHealth } from "../utils/outputHealthStore.ts";

/**
 * Render hook supplied by a UI adapter — `effects/` is forbidden from
 * importing `ui/` directly, so the rendering panel registers itself
 * here at boot.  `paint` is invoked once per visible tick;
 * `isVisible` gates whether to even call `paint`.
 */
export interface VisualisationRenderHook {
  /** Called at most once per tick when rendering is requested. */
  paint(): void;
  /** Cheap visibility check; render skips when this returns false. */
  isVisible(): boolean;
}

let renderHook: VisualisationRenderHook | null = null;

/** Register the renderer.  Idempotent; later calls replace the hook. */
export function registerVisualisationRenderHook(
  hook: VisualisationRenderHook | null,
): void {
  renderHook = hook;
}

// ── Tunables ─────────────────────────────────────────────────────────

/** Target ~30Hz tick rate.  Sampling and render share this budget. */
const TARGET_TICK_MS = 1000 / 30;

/** Poll runtime diagnostics every Nth tick (≈5Hz at 30Hz target). */
const DIAG_POLL_INTERVAL = 6;

// ── Tick state ───────────────────────────────────────────────────────

let running = false;
let frameId: number | null = null;
let lastTickMs = 0;
let frameCount = 0;

// ── Local time mode (browser-local) ─────────────────────────────────

let localTimeActive = false;
let localResetMs: number | null = null;
let localElapsedSeconds = 0;

// ── Sampling coalescing ─────────────────────────────────────────────
//
// `pendingSampleTime` is the latest time for which sampling has been
// requested but not yet completed.  `samplingInFlight` is true while a
// WASM call is awaiting.  When the in-flight call resolves we re-check
// `pendingSampleTime`; if it has advanced past `lastSampledTime`, we
// kick off another sample.  This is the new home for what used to be
// `samplingSequence` + `samplingInFlight` + the request/completed
// window-key pair.

let pendingSampleTime: number | null = null;
let samplingInFlight = false;
let lastSampledWindowKey: string | null = null;

// ── Render gating ────────────────────────────────────────────────────

let renderRequested = false;

// ── Public API ───────────────────────────────────────────────────────

/** Begin the rAF loop.  Idempotent. */
export function startVisualisationRuntime(): void {
  if (running || typeof window === "undefined") return;
  running = true;
  lastTickMs = 0;
  scheduleNextTick();
}

/** Cancel the rAF loop. */
export function stopVisualisationRuntime(): void {
  if (!running) return;
  running = false;
  if (frameId !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(frameId);
    frameId = null;
  }
}

/**
 * Toggle browser-local time mode.  When active, the rAF loop advances
 * `visStore.currentTime` from `performance.now`.  When inactive (e.g.
 * hardware connected), time is driven only by `notifyExternalTimeUpdate`.
 */
export function setLocalTimeMode(active: boolean): void {
  if (active === localTimeActive) return;
  localTimeActive = active;
  if (active) {
    if (localResetMs === null) {
      localResetMs = performance.now();
      localElapsedSeconds = 0;
    } else {
      // Resume from where we left off.
      localResetMs = performance.now() - localElapsedSeconds * 1000;
    }
    if (running) requestSampleAt(localElapsedSeconds);
  }
}

/** Reset the local clock to t=0.  Loop continues unless caller stops it. */
export function resetLocalTime(): void {
  localResetMs = localTimeActive ? performance.now() : null;
  localElapsedSeconds = 0;
  // Force the next sample to cover the new window.
  lastSampledWindowKey = null;
}

export function isLocalTimeActive(): boolean {
  return localTimeActive;
}

export function getLocalTime(): number {
  return localElapsedSeconds;
}

/**
 * Hardware path: a STREAM time value just arrived.  Latest-time-wins
 * coalescing — if a sample is already in flight, the older request is
 * superseded.  Idempotent if the time matches the last-sampled window.
 */
export function notifyExternalTimeUpdate(time: number): void {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return;
  // Surface the time to the store immediately for smooth rendering;
  // sampling catches up async on the rAF loop or below.
  updateTime(numeric);
  setLastChangeKind("time", {
    currentTimeSeconds: numeric,
    displayTimeSeconds: numeric,
  });
  requestSampleAt(numeric);
  // Even when the rAF loop is not running (e.g. unit tests), drain at
  // least once so callers see the effect synchronously-ish.
  void drainSamplingQueue();
}

/** Mark the canvas visible — start drawing each tick. */
export function requestVisualisationRender(): void {
  renderRequested = true;
  if (!running) startVisualisationRuntime();
  // Force an immediate render of the current state (so the panel is
  // populated even if no time/sample updates land before the next tick).
  scheduleImmediateRender();
}

/** Mark the canvas hidden — stop drawing.  Sampling continues if needed. */
export function pauseVisualisationRender(): void {
  renderRequested = false;
}

// ── Internal: rAF loop ───────────────────────────────────────────────

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

  // 1. Local time advance (when active).
  if (localTimeActive) {
    localElapsedSeconds = (now - (localResetMs ?? 0)) / 1000;
    updateTime(localElapsedSeconds);
    setLastChangeKind("time", {
      currentTimeSeconds: localElapsedSeconds,
      displayTimeSeconds: localElapsedSeconds,
    });
    requestSampleAt(localElapsedSeconds);
  }

  // 2. Diagnostics poll (≈5Hz).
  if (frameCount % DIAG_POLL_INTERVAL === 0) {
    const activeDiags = readActiveDiagnostics();
    refreshOutputHealth(activeDiags);
  }

  // 3. Drain sampling queue (no-op if nothing pending).
  void drainSamplingQueue();

  // 4. Render if the panel is visible.
  if (renderRequested) {
    renderFrame();
  }

  perf.end("frame-tick");
}

function scheduleImmediateRender(): void {
  if (typeof window === "undefined") return;
  // Use rAF rather than synchronous render so we cooperate with the
  // browser's paint schedule.
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

// ── Internal: sampling ───────────────────────────────────────────────

function requestSampleAt(time: number): void {
  pendingSampleTime = time;
}

/** Promise that resolves when the in-flight drain (if any) finishes. */
let inFlightDrainPromise: Promise<void> | null = null;

async function drainSamplingQueue(): Promise<void> {
  if (samplingInFlight) {
    // Already draining elsewhere — wait for it to finish so callers can
    // observe the side effects of any pending work.
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
      const window = computeSamplingWindow(timeSeconds, settings);
      const key = samplingWindowKey(window);
      if (key !== lastSampledWindowKey) {
        perf.begin("rebuild-all");
        await rebuildAllExpressions(settings, timeSeconds);
        perf.end("rebuild-all");
        lastSampledWindowKey = key;
      }
    }

    setLastChangeKind("data");
  } finally {
    perf.end("resample-total");
  }
}

/**
 * Force the next sample to recompute (e.g. after settings/palette change
 * or expression registration).  Does **not** synthesise a sample
 * request — the next rAF or external-time event will see the cleared
 * cache and run the work then.
 */
export function invalidateSamplingCache(): void {
  lastSampledWindowKey = null;
}

// ── Test seam ────────────────────────────────────────────────────────

/**
 * Internal helper for tests — not part of the public API.  Drains any
 * pending sampling work synchronously (await the returned promise).
 */
export async function _drainForTests(): Promise<void> {
  await drainSamplingQueue();
}

/** Reset all runtime state (test seam only). */
export function _resetForTests(): void {
  stopVisualisationRuntime();
  localTimeActive = false;
  localResetMs = null;
  localElapsedSeconds = 0;
  pendingSampleTime = null;
  samplingInFlight = false;
  lastSampledWindowKey = null;
  renderRequested = false;
  frameCount = 0;
  lastTickMs = 0;
}
