/**
 * Drift Detector — compares WASM tick outputs against hardware stream values.
 *
 * In `both` mode, hardware streams output values at ~30Hz (after stream-config
 * is sent during handshake). WASM independently evaluates the same outputs for
 * visualisation. This module compares the two to detect state divergence.
 *
 * The detector maintains per-output exponential moving averages of the relative
 * error. When the aggregate EMA exceeds a threshold, it publishes a
 * `driftDetected` channel event. A cooldown period after each publish (and
 * after each eval) prevents spurious triggers during settling.
 *
 * @see docs/specs/state-sync.md
 */

import { serialBuffers } from "../transport/stream-parser";
import {
  driftDetected as driftDetectedChannel,
  codeEvaluated as codeEvaluatedChannel,
} from "../contracts/runtimeChannels";
import type { DriftDetectedDetail } from "../contracts/runtimeChannels";
import { dbg } from "../lib/debug";

// ── Configuration ──────────────────────────────────────────���────────

const EMA_ALPHA = 0.15;
const HARD_DRIFT_THRESHOLD = 0.05;
const COOLDOWN_AFTER_SYNC_MS = 2_000;
const COOLDOWN_AFTER_EVAL_MS = 1_000;

const EPSILON = 1e-9;

// ── State ───────────────────────────────────────────────────────────

const emaScores: Map<string, number> = new Map();
let cooldownUntil = 0;
let enabled = false;

// ── Output name → serial buffer index mapping ───────────────────────
//
// Hardware stream channels are mapped via `serialOutputBufferRouting`:
// the firmware's `hello` response provides output names like "s1"..."s8"
// with index values that map to stream channel IDs. The routing table
// maps channel ID → buffer index in `serialBuffers[]`.
//
// Buffer index 0 is always time; output buffers start at 1.

function outputNameToBufferIndex(name: string): number | null {
  // Only serial outputs (s1–s8) have corresponding stream channels.
  // The routing table maps wire channel ID → buffer index, and for
  // output sN the buffer index is always N (by construction in
  // buildSerialOutputRouting). Verify the mapping exists.
  const match = /^s([1-9]\d*)$/.exec(name);
  if (!match) return null;
  const bufferIndex = Number.parseInt(match[1], 10);
  if (bufferIndex < 0 || bufferIndex >= serialBuffers.length) return null;
  return bufferIndex;
}

// ── Core comparison ─────────────────────────────────────────────────

function relativeError(hwValue: number, wasmValue: number): number {
  const diff = Math.abs(hwValue - wasmValue);
  const denom = Math.max(Math.abs(hwValue), Math.abs(wasmValue), EPSILON);
  return diff / denom;
}

/**
 * Feed a new comparison sample for one output. Called from the vis
 * sampler's tick path after each WASM tick that has a corresponding
 * hardware stream value.
 */
export function recordDriftSample(name: string, wasmValue: number): void {
  if (!enabled) return;
  if (performance.now() < cooldownUntil) return;

  const bufIdx = outputNameToBufferIndex(name);
  if (bufIdx === null) return;
  if (bufIdx < 0 || bufIdx >= serialBuffers.length) return;

  const buf = serialBuffers[bufIdx];
  if (!buf || buf.length === 0) return;

  const hwValue = buf.last(0);
  if (hwValue === undefined || !Number.isFinite(hwValue)) return;
  if (!Number.isFinite(wasmValue)) return;

  const error = relativeError(hwValue, wasmValue);
  const prev = emaScores.get(name) ?? 0;
  const next = prev * (1 - EMA_ALPHA) + error * EMA_ALPHA;
  emaScores.set(name, next);
}

/**
 * Check whether aggregate drift exceeds the threshold and, if so,
 * publish a drift event. Called once per animation frame.
 */
export function checkDriftThreshold(): DriftDetectedDetail | null {
  if (!enabled) return null;
  if (performance.now() < cooldownUntil) return null;
  if (emaScores.size === 0) return null;

  let sum = 0;
  let count = 0;
  const perOutput: Record<string, number> = {};

  for (const [name, score] of emaScores) {
    perOutput[name] = score;
    sum += score;
    count += 1;
  }

  const aggregate = count > 0 ? sum / count : 0;

  if (aggregate >= HARD_DRIFT_THRESHOLD) {
    const detail: DriftDetectedDetail = { perOutput, aggregate };
    try {
      driftDetectedChannel.publish(detail);
    } catch (e) {
      dbg(`driftDetector: failed to publish drift event: ${e}`);
    }
    cooldownUntil = performance.now() + COOLDOWN_AFTER_SYNC_MS;
    return detail;
  }

  return null;
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function enableDriftDetection(): void {
  enabled = true;
  emaScores.clear();
  cooldownUntil = performance.now() + COOLDOWN_AFTER_EVAL_MS;
}

export function disableDriftDetection(): void {
  enabled = false;
  emaScores.clear();
}

export function resetDriftScores(): void {
  emaScores.clear();
  cooldownUntil = performance.now() + COOLDOWN_AFTER_SYNC_MS;
}

export function isDriftDetectionEnabled(): boolean {
  return enabled;
}

export function getDriftScores(): ReadonlyMap<string, number> {
  return emaScores;
}

// Suppress drift detection briefly after each code evaluation — both
// runtimes need settling time after expression changes.
let evalUnsubscribe: (() => void) | null = null;

export function startEvalCooldownListener(): void {
  if (evalUnsubscribe) return;
  evalUnsubscribe = codeEvaluatedChannel.subscribe(() => {
    cooldownUntil = Math.max(
      cooldownUntil,
      performance.now() + COOLDOWN_AFTER_EVAL_MS,
    );
  });
}

export function stopEvalCooldownListener(): void {
  evalUnsubscribe?.();
  evalUnsubscribe = null;
}
