/**
 * Performance Tracing
 *
 * Lightweight instrumentation for the visualisation hot path.
 * Disabled by default — enable via `window.__useqPerf.enable()` in DevTools.
 *
 * Uses `performance.mark()` / `performance.measure()` so traces appear
 * natively in the DevTools Performance panel timeline.
 *
 * Usage:
 *   import { perf } from '../lib/perfTrace.ts';
 *   perf.begin('wasm-batch');
 *   // ... work ...
 *   perf.end('wasm-batch');
 *
 * Console summary:
 *   window.__useqPerf.report()   — print aggregated stats
 *   window.__useqPerf.reset()    — clear accumulated data
 *   window.__useqPerf.enable()   — start tracing
 *   window.__useqPerf.disable()  — stop tracing
 */

interface PerfEntry {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

let enabled = false;
const stats = new Map<string, PerfEntry>();
const openMarks = new Map<string, number>();

function begin(label: string): void {
  if (!enabled) return;
  openMarks.set(label, performance.now());
  performance.mark(`useq:${label}:start`);
}

function end(label: string): void {
  if (!enabled) return;
  const startTime = openMarks.get(label);
  if (startTime === undefined) return;
  openMarks.delete(label);

  const elapsed = performance.now() - startTime;
  performance.mark(`useq:${label}:end`);
  try {
    performance.measure(`useq:${label}`, `useq:${label}:start`, `useq:${label}:end`);
  } catch {
    // marks may have been cleared
  }

  let entry = stats.get(label);
  if (!entry) {
    entry = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, lastMs: 0 };
    stats.set(label, entry);
  }
  entry.count++;
  entry.totalMs += elapsed;
  entry.lastMs = elapsed;
  if (elapsed < entry.minMs) entry.minMs = elapsed;
  if (elapsed > entry.maxMs) entry.maxMs = elapsed;
}

/** Record a single-shot measurement (no begin/end pair needed). */
function record(label: string, durationMs: number): void {
  if (!enabled) return;
  let entry = stats.get(label);
  if (!entry) {
    entry = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, lastMs: 0 };
    stats.set(label, entry);
  }
  entry.count++;
  entry.totalMs += durationMs;
  entry.lastMs = durationMs;
  if (durationMs < entry.minMs) entry.minMs = durationMs;
  if (durationMs > entry.maxMs) entry.maxMs = durationMs;
}

function report(): void {
  if (stats.size === 0) {
    console.log("[useq-perf] No data collected. Call window.__useqPerf.enable() first.");
    return;
  }

  const rows: Array<{
    label: string;
    calls: number;
    "avg(ms)": string;
    "min(ms)": string;
    "max(ms)": string;
    "last(ms)": string;
    "total(ms)": string;
  }> = [];

  for (const [label, entry] of stats) {
    rows.push({
      label,
      calls: entry.count,
      "avg(ms)": (entry.totalMs / entry.count).toFixed(3),
      "min(ms)": entry.minMs === Infinity ? "-" : entry.minMs.toFixed(3),
      "max(ms)": entry.maxMs.toFixed(3),
      "last(ms)": entry.lastMs.toFixed(3),
      "total(ms)": entry.totalMs.toFixed(1),
    });
  }

  console.table(rows);
}

function reset(): void {
  stats.clear();
  openMarks.clear();
  performance.clearMarks();
  performance.clearMeasures();
  console.log("[useq-perf] Stats reset.");
}

function enable(): void {
  enabled = true;
  console.log("[useq-perf] Tracing enabled. Use report() to see stats.");
}

function disable(): void {
  enabled = false;
  console.log("[useq-perf] Tracing disabled.");
}

function isEnabled(): boolean {
  return enabled;
}

export const perf = { begin, end, record, report, reset, enable, disable, isEnabled };

// Expose on window for DevTools access
if (typeof window !== "undefined") {
  (window as any).__useqPerf = { enable, disable, report, reset };
}
