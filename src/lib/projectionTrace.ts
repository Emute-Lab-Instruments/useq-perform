/**
 * Future Projection Trace — DEV ONLY
 *
 * Structured, queryable event log for the faithful-past/projected-future
 * visualisation path. Every production call site must be guarded by
 * `if (import.meta.env.DEV)` so Rollup can remove both the calls and this
 * module from production bundles.
 *
 * DevTools usage:
 *   __useqProjectionTrace.enable({ capacity: 20000, captureSamples: true })
 *   // reproduce issue
 *   __useqProjectionTrace.recent(50)
 *   __useqProjectionTrace.byKind("sampler-mode")
 *   __useqProjectionTrace.forOutput("a1")
 *   __useqProjectionTrace.query({ kind: "renderer-build", output: "a1" })
 *   __useqProjectionTrace.disable()
 */

export interface ProjectionTraceEvent {
  seq: number;
  atMs: number;
  wallTime: number;
  kind: string;
  detail: Record<string, unknown>;
}

export interface ProjectionTraceEnableOptions {
  capacity?: number;
  captureSamples?: boolean;
}

export interface ProjectionTraceFilter {
  kind?: string;
  kinds?: string[];
  output?: string;
  sinceSeq?: number;
  untilSeq?: number;
  minAtMs?: number;
  maxAtMs?: number;
}

export interface ProjectionTraceSnapshot {
  enabled: boolean;
  capacity: number;
  captureSamples: boolean;
  nextSeq: number;
  count: number;
  capturedAt: number;
  events: ProjectionTraceEvent[];
}

export interface ProjectionTraceSummary {
  enabled: boolean;
  capacity: number;
  captureSamples: boolean;
  nextSeq: number;
  count: number;
  firstSeq: number | null;
  lastSeq: number | null;
  byKind: Array<{ kind: string; count: number }>;
}

let enabled = false;
let capacity = 10000;
let captureSamples = false;
let nextSeq = 1;
const events: ProjectionTraceEvent[] = [];

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normaliseCapacity(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return capacity;
  return Math.min(100000, Math.max(100, Math.floor(numeric)));
}

function trimToCapacity(): void {
  const overflow = events.length - capacity;
  if (overflow > 0) events.splice(0, overflow);
}

function detailMentionsOutput(detail: Record<string, unknown>, output: string): boolean {
  if (detail.output === output || detail.name === output || detail.exprType === output) {
    return true;
  }
  const outputs = detail.outputs;
  if (Array.isArray(outputs) && outputs.includes(output)) return true;
  const channels = detail.channels;
  if (Array.isArray(channels) && channels.includes(output)) return true;
  const perOutput = detail.perOutput;
  if (perOutput && typeof perOutput === "object" && output in perOutput) return true;
  return false;
}

function matchesFilter(event: ProjectionTraceEvent, filter: ProjectionTraceFilter): boolean {
  if (filter.kind && event.kind !== filter.kind) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.output && !detailMentionsOutput(event.detail, filter.output)) return false;
  if (filter.sinceSeq !== undefined && event.seq < filter.sinceSeq) return false;
  if (filter.untilSeq !== undefined && event.seq > filter.untilSeq) return false;
  if (filter.minAtMs !== undefined && event.atMs < filter.minAtMs) return false;
  if (filter.maxAtMs !== undefined && event.atMs > filter.maxAtMs) return false;
  return true;
}

function enable(options: ProjectionTraceEnableOptions = {}): void {
  capacity = normaliseCapacity(options.capacity);
  captureSamples = options.captureSamples === true;
  enabled = true;
  trimToCapacity();
  console.log(
    `[useq-projection-trace] enabled (capacity=${capacity}, captureSamples=${captureSamples})`,
  );
}

function disable(): void {
  enabled = false;
  console.log("[useq-projection-trace] disabled");
}

function reset(): void {
  events.length = 0;
  nextSeq = 1;
  console.log("[useq-projection-trace] reset");
}

function record(kind: string, detail: Record<string, unknown> = {}): void {
  if (!enabled) return;
  events.push({
    seq: nextSeq++,
    atMs: nowMs(),
    wallTime: Date.now(),
    kind,
    detail,
  });
  trimToCapacity();
}

function shouldCaptureSamples(): boolean {
  return enabled && captureSamples;
}

function query(filter: ProjectionTraceFilter = {}): ProjectionTraceEvent[] {
  return events.filter((event) => matchesFilter(event, filter));
}

function recent(count = 100): ProjectionTraceEvent[] {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  return events.slice(Math.max(0, events.length - safeCount));
}

function byKind(kind: string): ProjectionTraceEvent[] {
  return query({ kind });
}

function forOutput(output: string): ProjectionTraceEvent[] {
  return query({ output });
}

function snapshot(filter: ProjectionTraceFilter = {}): ProjectionTraceSnapshot {
  const filtered = query(filter);
  return {
    enabled,
    capacity,
    captureSamples,
    nextSeq,
    count: filtered.length,
    capturedAt: nowMs(),
    events: filtered,
  };
}

function summary(): ProjectionTraceSummary {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  const byKindRows = Array.from(counts, ([kind, count]) => ({ kind, count }));
  byKindRows.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return {
    enabled,
    capacity,
    captureSamples,
    nextSeq,
    count: events.length,
    firstSeq: events[0]?.seq ?? null,
    lastSeq: events[events.length - 1]?.seq ?? null,
    byKind: byKindRows,
  };
}

function dump(filter: ProjectionTraceFilter = {}): ProjectionTraceSnapshot {
  return snapshot(filter);
}

export const projectionTrace = {
  enable,
  disable,
  reset,
  record,
  shouldCaptureSamples,
  query,
  recent,
  byKind,
  forOutput,
  snapshot,
  dump,
  summary,
};

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __useqProjectionTrace: unknown }).__useqProjectionTrace = {
    enable,
    disable,
    reset,
    query,
    recent,
    byKind,
    forOutput,
    snapshot,
    dump,
    summary,
  };
}
