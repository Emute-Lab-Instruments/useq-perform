import {
  DEFAULT_PROBE_CANVAS_HEIGHT,
  DEFAULT_PROBE_CANVAS_WIDTH,
  DEFAULT_PROBE_WINDOW_DURATION_MS,
  MAX_PROBE_WINDOW_DURATION_MS,
  MIN_PROBE_WINDOW_DURATION_MS,
  type FromListHighlight,
  type PersistedProbeSpec,
  type ProbeConfig,
  type ProbeRenderData,
} from "./probeTypes.ts";

type ProbePersistence = Pick<
  ProbeConfig,
  "loadPersistedProbes" | "savePersistedProbes" | "removePersistedProbes"
>;

function isPersistedProbeSpec(value: unknown): value is PersistedProbeSpec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.from === "number" &&
    typeof candidate.to === "number" &&
    (candidate.mode === "raw" || candidate.mode === "contextual") &&
    typeof candidate.depth === "number" &&
    typeof candidate.maxDepth === "number" &&
    typeof candidate.cachedCode === "string"
  );
}

export function readPersistedProbes(
  persistence: ProbePersistence,
): PersistedProbeSpec[] {
  const loaded = persistence.loadPersistedProbes();
  if (!Array.isArray(loaded)) return [];
  return loaded.filter(isPersistedProbeSpec).map((probe) => ({
    ...probe,
    depth: Math.max(0, Math.floor(probe.depth)),
    maxDepth: Math.max(0, Math.floor(probe.maxDepth)),
    canvasWidth: Number.isFinite(probe.canvasWidth) && probe.canvasWidth > 0
      ? probe.canvasWidth
      : DEFAULT_PROBE_CANVAS_WIDTH,
    canvasHeight: Number.isFinite(probe.canvasHeight) && probe.canvasHeight > 0
      ? probe.canvasHeight
      : DEFAULT_PROBE_CANVAS_HEIGHT,
    windowDurationMs:
      Number.isFinite(probe.windowDurationMs) &&
      probe.windowDurationMs >= MIN_PROBE_WINDOW_DURATION_MS &&
      probe.windowDurationMs <= MAX_PROBE_WINDOW_DURATION_MS
        ? probe.windowDurationMs
        : DEFAULT_PROBE_WINDOW_DURATION_MS,
  }));
}

export function persistProbes(
  persistence: ProbePersistence,
  probes: PersistedProbeSpec[],
): void {
  if (probes.length === 0) {
    persistence.removePersistedProbes();
    return;
  }
  persistence.savePersistedProbes(probes);
}

export function probeSignature(probes: PersistedProbeSpec[]): string {
  if (probes.length === 0) return "";
  return probes
    .map((probe) =>
      `${probe.id}:${probe.from}:${probe.to}:${probe.depth}:${probe.windowDurationMs}`,
    )
    .join("|");
}

export function highlightsEqual(
  left: readonly FromListHighlight[],
  right: readonly FromListHighlight[],
): boolean {
  return (
    left.length === right.length &&
    left.every((highlight, index) => {
      const other = right[index];
      return (
        other?.from === highlight.from &&
        other.to === highlight.to &&
        other.mode === highlight.mode
      );
    })
  );
}

export function buildStaleRender(
  probe: PersistedProbeSpec,
): ProbeRenderData {
  return {
    revision: 0,
    kind: "stale",
    text: "probe text changed",
    samples: [],
    currentTime: 0,
    windowStart: 0,
    windowDuration: probe.windowDurationMs / 1000,
    depth: probe.depth,
    maxDepth: probe.maxDepth,
  };
}

export function updateProbeRender(
  existing: ProbeRenderData | undefined,
  next: Omit<ProbeRenderData, "revision">,
): ProbeRenderData {
  if (
    existing &&
    existing.kind === next.kind &&
    existing.text === next.text &&
    existing.currentTime === next.currentTime &&
    existing.windowStart === next.windowStart &&
    existing.windowDuration === next.windowDuration &&
    existing.depth === next.depth &&
    existing.maxDepth === next.maxDepth &&
    existing.samples.length === next.samples.length &&
    existing.samples.every((value, index) => value === next.samples[index])
  ) {
    return existing;
  }
  return {
    ...next,
    revision: (existing?.revision ?? 0) + 1,
  };
}
