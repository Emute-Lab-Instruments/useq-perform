/**
 * Local Clock
 *
 * When no hardware is connected, this is the time source for visualisation.
 * It computes elapsed time since the last transport reset using the browser's
 * high-resolution clock (performance.now).
 *
 * When hardware IS connected, the serial stream provides time values directly
 * and this clock is stopped.
 *
 * Design: time and sampling are independent concerns.
 * - This module advances `visStore.currentTime` every frame (rAF).
 * - The sampler runs in the background, populating expression data
 *   without blocking the clock.
 */

import { resampleExpressions } from './visualisationSampler.ts';
import { perf } from '../lib/perfTrace.ts';
import { setLastChangeKind, updateTime } from '../utils/visualisationStore.ts';
import { dbg } from '../lib/debug.ts';

let running = false;
let resetTimeMs: number | null = null;
let frameId: number | null = null;
let elapsedSeconds = 0;
let samplingInFlight = false;

function tick(): void {
  if (!running) return;
  perf.begin("frame-tick");

  // Always schedule next frame first — clock is never blocked
  frameId = window.requestAnimationFrame(tick);

  // Advance time
  elapsedSeconds = (performance.now() - (resetTimeMs ?? 0)) / 1000;
  updateTime(elapsedSeconds);
  setLastChangeKind("time", {
    currentTimeSeconds: elapsedSeconds,
    displayTimeSeconds: elapsedSeconds,
  });

  // Coalesce sampling: skip if a WASM evaluation is already running on the
  // main thread. The sampler's sequence counter discards stale results, but
  // this guard avoids queuing redundant synchronous WASM work that would
  // burn CPU and be thrown away.
  if (samplingInFlight) { perf.end("frame-tick"); return; }
  samplingInFlight = true;
  resampleExpressions(elapsedSeconds)
    .catch((e) => dbg(`localClock: sampling error: ${e}`))
    .finally(() => { samplingInFlight = false; });
  perf.end("frame-tick");
}

/** Start the local clock from t=0. */
export function startLocalClock(): boolean {
  if (running) return false;
  running = true;
  resetTimeMs = performance.now();
  elapsedSeconds = 0;
  frameId = window.requestAnimationFrame(tick);
  return true;
}

/** Stop the local clock (freeze time). */
export function stopLocalClock(): boolean {
  if (!running) return false;
  running = false;
  if (frameId !== null) {
    window.cancelAnimationFrame(frameId);
    frameId = null;
  }
  return true;
}

/** Resume the local clock from where it left off. */
export function resumeLocalClock(): boolean {
  if (running) return false;
  running = true;
  // Adjust reset time so elapsed time continues from where it stopped
  resetTimeMs = performance.now() - (elapsedSeconds * 1000);
  frameId = window.requestAnimationFrame(tick);
  return true;
}

/** Stop and reset the clock to t=0. */
export function resetLocalClock(): void {
  const wasRunning = running;
  if (wasRunning) stopLocalClock();
  resetTimeMs = null;
  elapsedSeconds = 0;
  if (wasRunning) startLocalClock();
}

/** Whether the local clock is currently running. */
export function isLocalClockRunning(): boolean {
  return running;
}

/** Current elapsed time in seconds. */
export function getLocalClockTime(): number {
  return elapsedSeconds;
}

// ── Backward-compatible aliases ──────────────────────────────────────
// TODO: Remove these once all consumers are updated.
export {
  startLocalClock as startMockTimeGenerator,
  stopLocalClock as stopMockTimeGenerator,
  resumeLocalClock as resumeMockTimeGenerator,
  resetLocalClock as resetMockTimeGenerator,
  isLocalClockRunning as isMockTimeGeneratorRunning,
  getLocalClockTime as getCurrentMockTime,
};
