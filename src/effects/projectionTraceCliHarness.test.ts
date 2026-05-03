import { describe, expect, it, vi } from "vitest";

const portState = vi.hoisted(() => ({
  tickAndProject: vi.fn(),
}));

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    capabilities: () => ({
      enabled: true,
      supportsEval: true,
      supportsTimeWindow: true,
      supportsTickAndProject: true,
    }),
    evalCode: vi.fn().mockResolvedValue("0.5"),
    updateTime: vi.fn().mockResolvedValue(undefined),
    evalOutputsInTimeWindow: vi.fn().mockResolvedValue(new Map()),
    tickAndProject: (...args: unknown[]) =>
      (portState.tickAndProject as (...inner: unknown[]) => unknown)(...args),
    readActiveDiagnostics: vi.fn().mockResolvedValue([]),
    readLastDiagnostics: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn().mockReturnValue({ visualisation: {} }),
  subscribeAppSettings: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("../lib/visualisationUtils.ts", () => ({
  getSerialVisPalette: vi.fn().mockReturnValue(["#ffaa00"]),
  getSerialVisChannelColor: vi.fn().mockReturnValue("#ffaa00"),
}));

vi.mock("../contracts/runtimeChannels", () => ({
  codeEvaluated: { subscribe: vi.fn() },
}));

vi.mock("../contracts/visualisationChannels", () => ({
  serialVisPaletteChangedChannel: { subscribe: vi.fn() },
  visualisationSessionChannel: { publish: vi.fn() },
}));

vi.mock("./mockControlInputs.ts", () => ({
  addValueChangeListener: vi.fn(),
}));

function barValue(time: number): number {
  const wrapped = time % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function spacingStats(times: number[]): {
  count: number;
  maxGap: number;
  medianGap: number;
} {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push(times[i] - times[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  return {
    count: times.length,
    maxGap: gaps[gaps.length - 1] ?? 0,
    medianGap: gaps[Math.floor(gaps.length / 2)] ?? 0,
  };
}

describe.skipIf(process.env.PROJECTION_TRACE_CLI !== "1")(
  "projection trace CLI harness",
  () => {
  it("drives (a1 bar) and reports visible-right-edge spacing", async () => {
    vi.resetModules();

    portState.tickAndProject = vi.fn(async (
      outputs: string[],
      tickTime: number,
      _projectionMode: number,
      projectEnd: number,
      numFutureSamples: number,
      projectionOrigin: number,
    ) => {
      const tickValues = new Map<string, number>();
      for (const name of outputs) tickValues.set(name, barValue(tickTime));

      const projectionSamples = new Map<string, Array<{ time: number; value: number }>>();
      if (numFutureSamples > 0) {
        const step = (projectEnd - projectionOrigin) / numFutureSamples;
        for (const name of outputs) {
          if (name === "bar") continue;
          const samples: Array<{ time: number; value: number }> = [];
          for (let i = 1; i <= numFutureSamples; i++) {
            const time = projectionOrigin + step * i;
            samples.push({ time, value: barValue(time) });
          }
          projectionSamples.set(name, samples);
        }
      }
      return { tickValues, projectionSamples };
    });

    const { projectionTrace } = await import("../lib/projectionTrace.ts");
    const sampler = await import("./visualisationSampler.ts");
    const { __serialVisGLInternals } = await import(
      "../ui/visualisation/serialVisGL.ts"
    );

    const settings = {
      showFutureProjection: true,
      windowDuration: 10,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
      futureLineAlpha: 0.6,
      minFutureSampleRate: 30,
      extensionBatchSize: 4,
      temporalSampleRateMultiplier: 1,
      inputEpsilon: 0.01,
    };

    projectionTrace.reset();
    projectionTrace.enable({ capacity: 50000, captureSamples: false });
    await sampler.registerVisualisation("a1", "(a1 bar)");
    sampler.setPastBufferSampleRate(240);

    const rows: Array<{
      frame: number;
      time: number;
      mode: string | undefined;
      visibleRightCount: number;
      visibleRightMaxGap: number;
      firstFutureGap: number | null;
      anchorSkippedDueGap: boolean;
    }> = [];

    for (let frame = 0; frame <= 150; frame++) {
      const time = frame / 60;
      await sampler.tickAndProject(time, settings);
      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();
      __serialVisGLInternals.buildCombinedSamples(
        "a1",
        () => renderData,
        time,
        4 / settings.minFutureSampleRate,
      );

      const future = renderData!.futureBuffer!;
      const visibleEnd = time + settings.windowDuration / 2;
      const rightStart = visibleEnd - 0.5;
      const rightTimes: number[] = [];
      for (let i = 0; i < future.length; i++) {
        const sampleTime = future.timeAt(i);
        if (sampleTime >= rightStart && sampleTime <= visibleEnd) {
          rightTimes.push(sampleTime);
        }
      }
      const stats = spacingStats(rightTimes);
      const recentMode = projectionTrace
        .byKind("sampler-mode")
        .at(-1)?.detail.modeLabel as string | undefined;
      const recentRender = projectionTrace
        .byKind("renderer-build")
        .at(-1)?.detail as Record<string, unknown> | undefined;
      rows.push({
        frame,
        time,
        mode: recentMode,
        visibleRightCount: stats.count,
        visibleRightMaxGap: stats.maxGap,
        firstFutureGap: recentRender?.firstFutureGap as number | null,
        anchorSkippedDueGap: recentRender?.anchorSkippedDueGap === true,
      });
    }

    const sparseRows = rows.filter((row) => row.visibleRightMaxGap > 0.01);
    const resetRows = rows.filter((row) => row.mode === "reset-fill");
    const extendRows = rows.filter((row) => row.mode === "extend");
    const summary = {
      frames: rows.length,
      resets: resetRows.length,
      extends: extendRows.length,
      sparseRows: sparseRows.length,
      worstRows: [...rows]
        .sort((a, b) => b.visibleRightMaxGap - a.visibleRightMaxGap)
        .slice(0, 8),
      transitionRows: rows
        .filter((row, index) => index > 0 && row.mode !== rows[index - 1].mode)
        .slice(0, 20),
      traceSummary: projectionTrace.summary(),
    };
    console.log("[projection-trace-cli]", JSON.stringify(summary, null, 2));

    projectionTrace.disable();
    expect(rows.length).toBe(151);
    expect(sparseRows).toEqual([]);
  });
  },
);
