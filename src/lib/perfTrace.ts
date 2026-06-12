/**
 * Performance Tracing — DEV ONLY
 *
 * Lightweight instrumentation for the visualisation hot path.  All call
 * sites are wrapped in `if (import.meta.env.DEV)` so production builds
 * tree-shake them out completely; the only thing that ships is whatever
 * code does NOT live behind that flag.
 *
 * Usage (in dev):
 *   window.__useqPerf.enable()    — start tracing
 *   // ... exercise the app ...
 *   window.__useqPerf.report()    — print aggregated timings + counters
 *   window.__useqPerf.dump()      — return same data as JSON (for agents)
 *   window.__useqPerf.snapshot()  — JSON snapshot without printing/reset
 *   window.__useqPerf.reset()     — clear accumulated data
 *   window.__useqPerf.disable()   — stop tracing
 *
 * Programmatic / headless-browser use (Playwright, CDP, Puppeteer):
 *   await page.evaluate(() => __useqReady);          // wait for bootstrap
 *   await page.evaluate(() => __useqPerf.enable());
 *   // ...drive the app via clicks / keypresses / __useqBench.run(...)...
 *   const data = await page.evaluate(() => __useqPerf.dump());
 *   // `data` is { timings: [...], counters: [...], capturedAt, sessionMs }.
 *
 * Two kinds of measurements:
 *   - Timings: `perf.begin(label)` / `perf.end(label)` wrap a span.
 *     `perf.record(label, ms)` records a one-shot duration.
 *   - Counters: `perf.count(label, n=1)` accumulates an integer.
 *     Use these to detect redundancy — e.g. fingerprint-cache hit vs
 *     miss, overlay paint skipped vs applied.
 *
 * Spans also surface as `performance.measure()` entries so they appear
 * natively in the DevTools Performance panel timeline.
 */

interface PerfEntry {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

let enabled = false;
let enabledAt: number | null = null;
const stats = new Map<string, PerfEntry>();
const counters = new Map<string, number>();
const openMarks = new Map<string, number>();

export interface PerfTimingRow {
  label: string;
  calls: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

export interface PerfDump {
  enabled: boolean;
  capturedAt: number;
  sessionMs: number;
  timings: PerfTimingRow[];
  counters: Array<{ label: string; count: number }>;
}

function buildDump(): PerfDump {
  const now = performance.now();
  const timings: PerfTimingRow[] = [];
  for (const [label, entry] of stats) {
    timings.push({
      label,
      calls: entry.count,
      totalMs: entry.totalMs,
      avgMs: entry.totalMs / entry.count,
      minMs: entry.minMs === Infinity ? 0 : entry.minMs,
      maxMs: entry.maxMs,
      lastMs: entry.lastMs,
    });
  }
  timings.sort((a, b) => b.totalMs - a.totalMs);

  const counterRows: Array<{ label: string; count: number }> = [];
  for (const [label, n] of counters) counterRows.push({ label, count: n });
  counterRows.sort((a, b) => b.count - a.count);

  return {
    enabled,
    capturedAt: now,
    sessionMs: enabledAt === null ? 0 : now - enabledAt,
    timings,
    counters: counterRows,
  };
}

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

/**
 * Bump a counter by `n` (default 1).  Used to detect redundancy and
 * cache hit-rates — e.g. how often the VBO upload fingerprint check
 * skipped a re-upload, or how often the future buffer needed a full
 * refill vs. just an edge push.
 */
function count(label: string, n: number = 1): void {
  if (!enabled) return;
  counters.set(label, (counters.get(label) ?? 0) + n);
}

function report(): void {
  if (stats.size === 0 && counters.size === 0) {
    console.log("[useq-perf] No data collected. Call window.__useqPerf.enable() first.");
    return;
  }

  if (stats.size > 0) {
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
    rows.sort((a, b) => Number(b["total(ms)"]) - Number(a["total(ms)"]));
    console.log("[useq-perf] timings:");
    console.table(rows);
  }

  if (counters.size > 0) {
    const counterRows: Array<{ label: string; count: number }> = [];
    for (const [label, n] of counters) {
      counterRows.push({ label, count: n });
    }
    counterRows.sort((a, b) => b.count - a.count);
    console.log("[useq-perf] counters:");
    console.table(counterRows);
  }
}

function reset(): void {
  stats.clear();
  counters.clear();
  openMarks.clear();
  performance.clearMarks();
  performance.clearMeasures();
  if (enabled) enabledAt = performance.now();
  console.log("[useq-perf] Stats reset.");
}

function enable(): void {
  enabled = true;
  enabledAt = performance.now();
  console.log("[useq-perf] Tracing enabled. Use report() to see stats.");
}

function disable(): void {
  enabled = false;
  console.log("[useq-perf] Tracing disabled.");
}

function isEnabled(): boolean {
  return enabled;
}

/**
 * Return current stats as JSON.  Same data as `report()` but returned
 * instead of console-logged — designed for headless / Playwright /
 * CDP-driven profiling so an AI agent can `await page.evaluate(() =>
 * __useqPerf.dump())` and parse the result.  Does NOT reset.
 */
function dump(): PerfDump {
  return buildDump();
}

/**
 * Alias for `dump()`.  Both return a snapshot without resetting.  Kept
 * separate so future expansions can give `snapshot()` a different shape
 * (e.g. include in-flight open spans) without breaking `dump()` callers.
 */
function snapshot(): PerfDump {
  return buildDump();
}

export const perf = {
  begin, end, record, count,
  report, dump, snapshot, reset,
  enable, disable, isEnabled,
};

// Expose on window for DevTools access — DEV only.  In production
// builds Vite substitutes `import.meta.env.DEV` with `false` and
// Rollup eliminates this branch (and, when no other module statically
// imports `perf`, the entire module). The `typeof` guard keeps the module
// loadable outside Vite (mocha runs under plain node + tsx, where
// `import.meta.env` is undefined).
if (typeof import.meta.env !== "undefined" && import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __useqPerf: unknown }).__useqPerf = {
    enable, disable, report, dump, snapshot, reset,
  };
}
