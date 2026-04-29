/**
 * Local Clock — thin shim over `visualisationRuntime`.
 *
 * Historically this module owned its own rAF loop and called the
 * visualisation sampler directly.  Ownership has moved to
 * `visualisationRuntime`, which runs a single rAF loop driving both
 * sampling and rendering.  These exports remain so that
 * `transportClock.ts` and other callers can keep their existing API
 * without caring where the loop actually lives.
 *
 * "Local clock running" now means "runtime is in local-time mode" —
 * i.e. each tick advances `visStore.currentTime` from `performance.now`.
 * Hardware mode disables local-time mode but the runtime itself stays
 * running so external time updates still drive sampling and the
 * renderer continues to draw.
 */

import {
  startVisualisationRuntime,
  stopVisualisationRuntime,
  setLocalTimeMode,
  resetLocalTime,
  isLocalTimeActive,
  getLocalTime,
} from "./visualisationRuntime.ts";

/** Start the local clock from t=0. */
export function startLocalClock(): boolean {
  if (isLocalTimeActive()) return false;
  resetLocalTime();
  startVisualisationRuntime();
  setLocalTimeMode(true);
  return true;
}

/** Stop the local clock (freeze time).  The runtime keeps running for
 *  rendering and any external time updates. */
export function stopLocalClock(): boolean {
  if (!isLocalTimeActive()) return false;
  setLocalTimeMode(false);
  return true;
}

/** Resume the local clock from where it left off. */
export function resumeLocalClock(): boolean {
  if (isLocalTimeActive()) return false;
  startVisualisationRuntime();
  setLocalTimeMode(true);
  return true;
}

/** Stop and reset the clock to t=0. */
export function resetLocalClock(): void {
  const wasRunning = isLocalTimeActive();
  setLocalTimeMode(false);
  resetLocalTime();
  if (wasRunning) setLocalTimeMode(true);
}

/** Whether the local clock is currently advancing time. */
export function isLocalClockRunning(): boolean {
  return isLocalTimeActive();
}

/** Current elapsed time in seconds. */
export function getLocalClockTime(): number {
  return getLocalTime();
}

/** Tear down both the local-time mode and the rAF loop.  Useful in
 *  tests; production code should prefer `stopLocalClock`. */
export function shutdownLocalClock(): void {
  setLocalTimeMode(false);
  stopVisualisationRuntime();
}

// ── Backward-compatible aliases ──────────────────────────────────────
export {
  startLocalClock as startMockTimeGenerator,
  stopLocalClock as stopMockTimeGenerator,
  resumeLocalClock as resumeMockTimeGenerator,
  resetLocalClock as resetMockTimeGenerator,
  isLocalClockRunning as isMockTimeGeneratorRunning,
  getLocalClockTime as getCurrentMockTime,
};
