/**
 * Adaptive Visualisation Quality
 *
 * Pressure detector + lever wiring for graceful visualisation degradation
 * under sustained frame pressure.
 *
 * Spec: docs/specs/visualisation.md §1.7 / §9.2.
 *
 * Design:
 *   - The rAF loop in `visualisationRuntime.tick()` reports each tick's
 *     elapsed time via `recordTickElapsed(elapsedMs)`.
 *   - We keep a rolling window of the last N=8 elapsed times.
 *   - A "miss" is `>= 50ms` (drop to ≤ 20fps).
 *   - 3+ misses → pressure level 1 (mild).
 *   - 6+ misses → pressure level 2 (severe).
 *   - Hysteresis: only step *down* after 16 consecutive normal ticks.
 *   - Level changes are logged via `dbg()`.
 *
 * Three levers consume the pressure level:
 *   1. `tickAndProject` skips the per-frame future-edge push when level ≥ 1.
 *   2. The probe scheduler multiplies its refresh interval by
 *      `getProbeIntervalMultiplier()` (1× / 2× / 4×).
 *   3. The renderer divides the pixel-matched buffer rate by
 *      `getSampleRateDivisor()` (1 / 2 / 4) before pushing to the sampler.
 *
 * The whole thing is gated by the `visualisation.adaptiveQuality` setting
 * (default `true`). When disabled, detection still runs (cheap) but
 * pressure level always reports `0` to consumers.
 */

import { dbg } from "../lib/debug.ts";

// ── Tunables ────────────────────────────────────────────────────────

/** How many recent frames to count when deciding pressure level. */
export const PRESSURE_WINDOW = 8;

/** A tick taking ≥ this many ms is a "miss" (i.e. ≤ 20fps). */
export const MISS_THRESHOLD_MS = 50;

/** Misses-in-window threshold for pressure level 1 (mild). */
export const MILD_MISS_COUNT = 3;

/** Misses-in-window threshold for pressure level 2 (severe). */
export const SEVERE_MISS_COUNT = 6;

/**
 * Number of consecutive normal ticks (no miss) required before stepping
 * pressure level down. Prevents oscillation under bursty load.
 */
export const RECOVERY_NORMAL_TICKS = 16;

// ── State ───────────────────────────────────────────────────────────

export type PressureLevel = 0 | 1 | 2;

let currentLevel: PressureLevel = 0;
const recent: number[] = [];
let normalTickStreak = 0;
let adaptiveEnabled = true;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Toggle the adaptive quality feature.  When `false`, all consumers see
 * pressure level `0` regardless of detected misses.
 */
export function setAdaptiveQualityEnabled(enabled: boolean): void {
  adaptiveEnabled = enabled !== false;
}

export function isAdaptiveQualityEnabled(): boolean {
  return adaptiveEnabled;
}

/** Current effective pressure level (always 0 when adaptive is disabled). */
export function getPressureLevel(): PressureLevel {
  return adaptiveEnabled ? currentLevel : 0;
}

/** Raw detector level — always reflects measurements, ignores enabled flag. */
export function getRawPressureLevel(): PressureLevel {
  return currentLevel;
}

/**
 * Lever 2 multiplier: probe refresh interval is multiplied by this so
 * probes refresh less often under pressure.
 */
export function getProbeIntervalMultiplier(): number {
  switch (getPressureLevel()) {
    case 1:
      return 2;
    case 2:
      return 4;
    default:
      return 1;
  }
}

/**
 * Lever 3 divisor: the renderer divides its pixel-matched sample rate
 * by this before calling `setPastBufferSampleRate()`.
 */
export function getSampleRateDivisor(): number {
  switch (getPressureLevel()) {
    case 1:
      return 2;
    case 2:
      return 4;
    default:
      return 1;
  }
}

/**
 * Lever 1 query: should the current frame skip the per-frame future
 * edge push?  True when pressure level ≥ 1 (and adaptive enabled).
 */
export function shouldSkipFutureEdgePush(): boolean {
  return getPressureLevel() >= 1;
}

/**
 * Record one rAF tick's elapsed time and recompute the pressure level.
 * Called from `visualisationRuntime.tick()` on every frame.
 *
 * Returns the new pressure level so callers can act immediately if
 * desired (none currently do).
 */
export function recordTickElapsed(elapsedMs: number): PressureLevel {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return currentLevel;

  recent.push(elapsedMs);
  if (recent.length > PRESSURE_WINDOW) recent.shift();

  const isMiss = elapsedMs >= MISS_THRESHOLD_MS;
  if (isMiss) {
    normalTickStreak = 0;
  } else {
    normalTickStreak++;
  }

  // Count misses in the rolling window.
  let missCount = 0;
  for (const ms of recent) {
    if (ms >= MISS_THRESHOLD_MS) missCount++;
  }

  // Compute the candidate level from the miss count.
  let candidate: PressureLevel;
  if (missCount >= SEVERE_MISS_COUNT) candidate = 2;
  else if (missCount >= MILD_MISS_COUNT) candidate = 1;
  else candidate = 0;

  // Hysteresis: only step *up* eagerly; step *down* after a streak of
  // normal ticks. Stepping up is allowed any time the candidate exceeds
  // the current level.
  let next: PressureLevel = currentLevel;
  if (candidate > currentLevel) {
    next = candidate;
  } else if (candidate < currentLevel) {
    if (normalTickStreak >= RECOVERY_NORMAL_TICKS) {
      next = candidate;
    }
  }

  if (next !== currentLevel) {
    const prev = currentLevel;
    currentLevel = next;
    if (next < prev) {
      // Reset the streak counter on a step-down so we don't immediately
      // drop again on the next normal tick.
      normalTickStreak = 0;
    }
    const histo = recent.map((v) => v.toFixed(1)).join(",");
    dbg(
      `adaptiveQuality: pressure ${prev} -> ${next} (misses=${missCount}/${recent.length}, elapsed[ms]=[${histo}])`,
    );
  }

  return currentLevel;
}

// ── Test seam ──────────────────────────────────────────────────────

export function _resetForTests(): void {
  currentLevel = 0;
  recent.length = 0;
  normalTickStreak = 0;
  adaptiveEnabled = true;
}
