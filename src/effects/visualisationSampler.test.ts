/**
 * Regression tests for the visualisation sampling boundary.
 *
 * After consolidation (`bd useq-perform-7hs`) sampling state lives in
 * `visualisationRuntime`; the sampler module exposes pure helpers
 * (`registerVisualisation`, `rebuildAllExpressions`, etc.).  These tests
 * cover both modules through their public API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The legacy `wasmInterpreter` mock holds the canonical spy instances —
// existing tests grab spies from here. The active-port mock below
// delegates to these so production code (which now goes through the
// port) and the tests (which assert on the legacy spies) hit the same
// vi.fn instances.
const wasmInterpreterMocks = vi.hoisted(() => ({
  evalInUseqWasm: vi.fn().mockResolvedValue("0.5"),
  updateUseqWasmTime: vi.fn().mockResolvedValue(undefined),
  evalOutputAtTime: vi.fn().mockResolvedValue(0.5),
  evalOutputsInTimeWindow: vi.fn().mockImplementation(
    (exprTypes: string[], start: number, end: number, count: number) => {
      const result = new Map<string, Array<{ time: number; value: number }>>();
      const step = count > 1 ? (end - start) / (count - 1) : 0;
      for (const expr of exprTypes) {
        const samples: Array<{ time: number; value: number }> = [];
        for (let i = 0; i < count; i++) {
          samples.push({ time: start + step * i, value: 0.5 });
        }
        result.set(expr, samples);
      }
      return Promise.resolve(result);
    },
  ),
  readActiveDiagnostics: vi.fn().mockReturnValue([]),
}));

vi.mock("../runtime/wasmInterpreter.ts", () => wasmInterpreterMocks);

// Mutable state for the active-port mock so individual tests can
// flip between fallback (default) and combined (opt-in) shapes
// without re-mocking the module (which fights vi.resetModules +
// transitive imports).
const portState = vi.hoisted(() => ({
  supportsTickAndProject: false,
  tickAndProject: vi.fn().mockResolvedValue(null),
}));

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    capabilities: () => ({
      enabled: true,
      supportsEval: true,
      supportsTimeWindow: true,
      supportsTickAndProject: portState.supportsTickAndProject,
    }),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    evalCode: wasmInterpreterMocks.evalInUseqWasm,
    evalCodeSilently: wasmInterpreterMocks.evalInUseqWasm,
    updateTime: wasmInterpreterMocks.updateUseqWasmTime,
    evalOutputAtTime: wasmInterpreterMocks.evalOutputAtTime,
    evalOutputsInTimeWindow: wasmInterpreterMocks.evalOutputsInTimeWindow,
    // Default: combined export unavailable (state set to false above),
    // forcing the legacy 2-call fallback path so existing tests assert
    // on the canonical evalOutputsInTimeWindow spy.  Specific tests
    // opt into the combined path by setting portState.* before
    // exercising the sampler.
    tickAndProject: (...args: unknown[]) =>
      (portState.tickAndProject as (...a: unknown[]) => unknown)(...args),
    readActiveDiagnostics: vi.fn().mockResolvedValue([]),
    readLastDiagnostics: vi.fn().mockResolvedValue([]),
  }),
  setActiveWasmRuntimePort: vi.fn(),
  isUsingInProcessWasmRuntime: () => true,
}));

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn().mockReturnValue({ visualisation: {} }),
  subscribeAppSettings: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("../lib/visualisationUtils.ts", () => ({
  getSerialVisPalette: vi.fn().mockReturnValue(["#ff0000", "#00ff00", "#0000ff"]),
  getSerialVisChannelColor: vi.fn().mockReturnValue("#ff0000"),
}));

vi.mock("../contracts/runtimeChannels", () => ({
  codeEvaluated: { subscribe: vi.fn() },
}));

vi.mock("../contracts/visualisationChannels", () => ({
  serialVisPaletteChangedChannel: { subscribe: vi.fn() },
  visualisationSessionChannel: { publish: vi.fn() },
}));

vi.mock("../utils/outputHealthStore.ts", () => ({
  refreshOutputHealth: vi.fn(),
}));

describe("visualisation sampling boundary", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  describe("concurrent expression registration (regression: race condition)", () => {
    it("preserves all expressions when registering 3+ sequentially", async () => {
      const { registerVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await registerVisualisation("a1", "(a1 (sin 1))");
      await registerVisualisation("a2", "(a2 (sin 2))");
      await registerVisualisation("a3", "(a3 (sin 3))");

      expect(isExpressionVisualised("a1")).toBe(true);
      expect(isExpressionVisualised("a2")).toBe(true);
      expect(isExpressionVisualised("a3")).toBe(true);
    });

    it("preserves existing expressions when rebuildAll runs after register", async () => {
      const sampler = await import("./visualisationSampler.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      await sampler.registerVisualisation("a2", "(a2 (sin 2))");
      await sampler.registerVisualisation("d1", "(d1 (square 1))");

      sampler.notifyExpressionEvaluated();
      await new Promise((r) => setTimeout(r, 50));

      expect(sampler.isExpressionVisualised("a1")).toBe(true);
      expect(sampler.isExpressionVisualised("a2")).toBe(true);
      expect(sampler.isExpressionVisualised("d1")).toBe(true);
    });

    it("toggleVisualisation correctly toggles on and off", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      expect(isExpressionVisualised("a1")).toBe(false);

      await toggleVisualisation("a1", "(a1 (sin 1))");
      expect(isExpressionVisualised("a1")).toBe(true);

      await toggleVisualisation("a1", "(a1 (sin 1))");
      expect(isExpressionVisualised("a1")).toBe(false);
    });

    it("only one expression per output can be active at a time (regression: shared active state)", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 (sin 1))", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(false);

      await toggleVisualisation("a1", "(a1 (sin 1))", { from: 5, to: 5 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(true);
      expect(isExpressionVisualised("a1")).toBe(true);
    });

    it("toggling different positions for same exprType tracks both separately", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 (sin 1))", { from: 1, to: 2 });
      expect(isExpressionVisualised("a1", { from: 1, to: 2 })).toBe(true);
      expect(isExpressionVisualised("a1", { from: 10, to: 11 })).toBe(false);

      await toggleVisualisation("a1", "(a1 (sin 1))", { from: 10, to: 11 });
      expect(isExpressionVisualised("a1", { from: 1, to: 2 })).toBe(false);
      expect(isExpressionVisualised("a1", { from: 10, to: 11 })).toBe(true);

      await toggleVisualisation("a1", "(a1 (sin 1))", { from: 10, to: 11 });
      expect(isExpressionVisualised("a1", { from: 10, to: 11 })).toBe(false);
      expect(isExpressionVisualised("a1")).toBe(false);
    });

    it("isExpressionVisualised without position returns true if any position is active", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 (sin 1))", { from: 5, to: 5 });
      expect(isExpressionVisualised("a1")).toBe(true);
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(true);
    });
  });

  describe("faithful past / projected future (spec: visualisation.md §2–§3)", () => {
    it("tick advances state and records values in past buffer", async () => {
      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockBatch = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      mockBatch.mockClear();
      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // Tick calls evalOutputsInTimeWindow to advance state. Bar is
      // folded into the same batch, so the tick-phase call should ask
      // for ["bar", "a1"] at t=5.0 (single-sample window).
      const tickCall = mockBatch.mock.calls.find(
        ([_outputs, start, end, count]) => start === 5.0 && end === 5.0 && count === 1,
      );
      expect(tickCall).toBeDefined();
      expect(tickCall![0]).toEqual(["bar", "a1"]);

      // Past buffer should have recorded the value
      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();
      expect(renderData!.pastBuffer.length).toBeGreaterThan(0);
    });

    it("past buffer preserved across expression change", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();
      runtime.notifyExternalTimeUpdate(5.033);
      await runtime._drainForTests();

      const renderData = sampler.getRenderData("a1");
      const pastLengthBefore = renderData!.pastBuffer.length;
      expect(pastLengthBefore).toBeGreaterThan(0);

      // Change expression — past buffer must survive
      await sampler.refreshVisualisedExpression("a1", "(a1 (sin 2))");

      const renderDataAfter = sampler.getRenderData("a1");
      expect(renderDataAfter!.pastBuffer.length).toBe(pastLengthBefore);
    });

    it("each tick records to the rolling buffer (consecutive ticks accumulate)", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.016);
      await runtime._drainForTests();
      runtime.notifyExternalTimeUpdate(5.033);
      await runtime._drainForTests();

      const renderData = sampler.getRenderData("a1");
      expect(renderData!.pastBuffer.length).toBe(2);
    });

    it("future buffer is produced alongside the tick", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      const renderData = sampler.getRenderData("a1");
      expect(renderData!.futureBuffer).toBeDefined();
      expect(renderData!.futureBuffer!.length).toBeGreaterThan(0);
    });
  });

  describe("in-flight stale-batch guard (spec: visualisation.md §1.8)", () => {
    function defaultBatchImpl(
      exprTypes: string[],
      start: number,
      end: number,
      count: number,
    ): Promise<Map<string, Array<{ time: number; value: number }>>> {
      const result = new Map<string, Array<{ time: number; value: number }>>();
      const step = count > 1 ? (end - start) / (count - 1) : 0;
      for (const expr of exprTypes) {
        const samples = [];
        for (let i = 0; i < count; i++) {
          samples.push({ time: start + step * i, value: 0.5 });
        }
        result.set(expr, samples);
      }
      return Promise.resolve(result);
    }

    afterEach(async () => {
      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      vi.mocked(evalOutputsInTimeWindow).mockReset();
      vi.mocked(evalOutputsInTimeWindow).mockImplementation(defaultBatchImpl);
    });

    it("never runs two tick-and-project cycles concurrently", async () => {
      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockEvalWindow = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      let inFlight = 0;
      let maxInFlight = 0;
      const resolvers: Array<() => void> = [];
      mockEvalWindow.mockReset();
      mockEvalWindow.mockImplementation(
        (exprTypes: string[], start: number, end: number, count: number) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          return new Promise((resolve) => {
            resolvers.push(() => {
              inFlight--;
              const result = new Map<
                string,
                Array<{ time: number; value: number }>
              >();
              const step = count > 1 ? (end - start) / (count - 1) : 0;
              for (const expr of exprTypes) {
                const samples = [];
                for (let i = 0; i < count; i++) {
                  samples.push({ time: start + step * i, value: 0.5 });
                }
                result.set(expr, samples);
              }
              resolve(result);
            });
          });
        },
      );

      runtime.notifyExternalTimeUpdate(5.0);
      runtime.notifyExternalTimeUpdate(8.0);
      runtime.notifyExternalTimeUpdate(11.0);

      await new Promise((r) => setTimeout(r, 0));
      // Only one batch in flight at a time (coalescing)
      expect(maxInFlight).toBeLessThanOrEqual(1);

      while (resolvers.length > 0) {
        const next = resolvers.shift()!;
        next();
        await new Promise((r) => setTimeout(r, 0));
      }
      await runtime._drainForTests();

      expect(maxInFlight).toBeLessThanOrEqual(1);
    });

    it("coalescing ensures the freshest time is processed", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      runtime.notifyExternalTimeUpdate(25.0);
      await runtime._drainForTests();

      // The past buffer should contain the freshest time's value
      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();
      expect(renderData!.pastBuffer.length).toBeGreaterThan(0);
      expect(renderData!.pastBuffer.newestTime).toBe(25.0);
    });
  });

  describe("visualisationSessionChannel publication (regression: stale gutter)", () => {
    it("publishes to channel on register", async () => {
      const { visualisationSessionChannel } = await import(
        "../contracts/visualisationChannels"
      );
      const { registerVisualisation } = await import(
        "./visualisationSampler.ts"
      );
      const mockPublish = vi.mocked(visualisationSessionChannel.publish);
      mockPublish.mockClear();

      await registerVisualisation("a1", "(a1 (sin 1))");

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "register", exprType: "a1" }),
      );
    });

    it("publishes to channel on unregister", async () => {
      const { visualisationSessionChannel } = await import(
        "../contracts/visualisationChannels"
      );
      const { registerVisualisation, unregisterVisualisation } = await import(
        "./visualisationSampler.ts"
      );
      const mockPublish = vi.mocked(visualisationSessionChannel.publish);

      await registerVisualisation("a1", "(a1 (sin 1))");
      mockPublish.mockClear();

      unregisterVisualisation("a1");

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "unregister", exprType: "a1" }),
      );
    });
  });

  describe("notifyExternalTimeUpdate (regression: decoupled time/sampling)", () => {
    it("updates the store time eagerly and queues a sample", async () => {
      const { visStore } = await import("../utils/visualisationStore.ts");
      const { notifyExternalTimeUpdate, _drainForTests } = await import(
        "./visualisationRuntime.ts"
      );

      notifyExternalTimeUpdate(2.5);
      expect(visStore.currentTime).toBe(2.5);

      // The drain promise resolves once the queued sample has run.
      await _drainForTests();
    });

    it("ignores non-finite times", async () => {
      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const { notifyExternalTimeUpdate, _drainForTests } = await import(
        "./visualisationRuntime.ts"
      );
      const mockEvalWindow = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      mockEvalWindow.mockClear();

      notifyExternalTimeUpdate(Number.NaN);
      await _drainForTests();

      expect(mockEvalWindow).not.toHaveBeenCalled();
    });
  });

  describe("multi-expression gutter and vis toggle flow (regression: shared active state)", () => {
    it("empty buffer - no expressions visualised", async () => {
      const { isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );
      expect(isExpressionVisualised("a1")).toBe(false);
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
    });

    it("toggle vis on then off for same position", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
    });

    it("two expressions at different positions - only one can be visualised at a time", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(false);

      await toggleVisualisation("a1", "(a1 beat)", { from: 5, to: 5 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(true);
      expect(isExpressionVisualised("a1")).toBe(true);
    });

    it("toggle off current expr - all vis state cleared", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
      expect(isExpressionVisualised("a1")).toBe(false);
    });

    it("switching vis toggle preserves evaluation tracking (gutter vs vis independent)", async () => {
      const { toggleVisualisation, isExpressionVisualised } = await import(
        "./visualisationSampler.ts"
      );

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);

      await toggleVisualisation("a1", "(a1 beat)", { from: 5, to: 5 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(true);

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(false);
    });

    it("full flow: toggle first expr, toggle second expr, toggle back to first", async () => {
      const {
        toggleVisualisation,
        isExpressionVisualised,
      } = await import("./visualisationSampler.ts");

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);

      await toggleVisualisation("a1", "(a1 beat)", { from: 5, to: 5 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(false);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(true);

      await toggleVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);
      expect(isExpressionVisualised("a1", { from: 5, to: 5 })).toBe(false);
    });

    it("register with position - expression is tracked", async () => {
      const {
        registerVisualisation,
        isExpressionVisualised,
      } = await import("./visualisationSampler.ts");

      await registerVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(isExpressionVisualised("a1")).toBe(true);
      expect(isExpressionVisualised("a1", { from: 1, to: 1 })).toBe(true);
    });

    it("keeps the last known good expression text when refresh fails", async () => {
      const { evalInUseqWasm } = await import("../runtime/wasmInterpreter.ts");
      const { evalOutputsInTimeWindow } = await import("../runtime/wasmInterpreter.ts");
      const { visStore } = await import("../utils/visualisationStore.ts");
      const {
        registerVisualisation,
        refreshVisualisedExpression,
      } = await import("./visualisationSampler.ts");
      const mockEval = vi.mocked(evalInUseqWasm);
      const mockEvalWindow = vi.mocked(evalOutputsInTimeWindow);

      mockEval.mockReset();
      mockEval.mockResolvedValue("0.5");

      await registerVisualisation("a1", "(a1 bar)", { from: 1, to: 1 });
      expect(visStore.expressions.a1?.expressionText).toBe("(a1 bar)");

      mockEval.mockRejectedValueOnce(new Error("bad expression"));
      mockEval.mockResolvedValueOnce("0.5");
      await refreshVisualisedExpression("a1", "(a1 (", { from: 2, to: 2 });

      expect(visStore.expressions.a1).toMatchObject({
        expressionText: "(a1 bar)",
        position: { from: 2, to: 2 },
      });
      expect(mockEval.mock.calls.slice(-2)).toEqual([
        ["(a1 ("],
        ["(a1 bar)"],
      ]);

      mockEval.mockResolvedValueOnce("0.5");
      await refreshVisualisedExpression("a1", "(a1 beat)", { from: 3, to: 3 });

      expect(visStore.expressions.a1).toMatchObject({
        expressionText: "(a1 beat)",
        position: { from: 3, to: 3 },
      });

      mockEvalWindow.mockClear();
      mockEval.mockRejectedValueOnce(new Error("bad expression"));
      mockEval.mockRejectedValueOnce(new Error("restore failed"));

      await refreshVisualisedExpression("a1", "(a1 (/ 1 0", { from: 4, to: 4 });

      expect(visStore.expressions.a1).toMatchObject({
        expressionText: "(a1 beat)",
        position: { from: 4, to: 4 },
      });
    });

    it("treats a literal {error} eval result as a failed refresh", async () => {
      const { evalInUseqWasm } = await import("../runtime/wasmInterpreter.ts");
      const { visStore } = await import("../utils/visualisationStore.ts");
      const {
        registerVisualisation,
        refreshVisualisedExpression,
      } = await import("./visualisationSampler.ts");
      const mockEval = vi.mocked(evalInUseqWasm);

      mockEval.mockReset();
      mockEval.mockResolvedValue("0.5");

      await registerVisualisation("a1", "(a1 (slow 2 bar))", { from: 1, to: 1 });
      expect(visStore.expressions.a1?.expressionText).toBe("(a1 (slow 2 bar))");

      mockEval.mockResolvedValueOnce("{error}");
      mockEval.mockResolvedValueOnce("0.5");
      await refreshVisualisedExpression("a1", "(a1 (slow  bar))", { from: 2, to: 2 });

      expect(visStore.expressions.a1).toMatchObject({
        expressionText: "(a1 (slow 2 bar))",
        position: { from: 2, to: 2 },
      });
      expect(mockEval.mock.calls.slice(-2)).toEqual([
        ["(a1 (slow  bar))"],
        ["(a1 (slow 2 bar))"],
      ]);
    });
  });

  describe("pixel-matched past buffer sample rate (spec: visualisation.md §2.2.1)", () => {
    it("setPastBufferSampleRate is a no-op when the rate is unchanged", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const before = sampler.getPastBufferSampleRate();
      sampler.setPastBufferSampleRate(before);
      expect(sampler.getPastBufferSampleRate()).toBe(before);
    });

    it("ignores non-finite or non-positive rates", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const before = sampler.getPastBufferSampleRate();
      sampler.setPastBufferSampleRate(Number.NaN);
      sampler.setPastBufferSampleRate(0);
      sampler.setPastBufferSampleRate(-50);
      expect(sampler.getPastBufferSampleRate()).toBe(before);
    });

    it("snaps fractional rates to the nearest integer Hz", async () => {
      const sampler = await import("./visualisationSampler.ts");
      sampler.setPastBufferSampleRate(123.4);
      expect(sampler.getPastBufferSampleRate()).toBe(123);
    });

    it("preserves recorded past samples when the rate changes", async () => {
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      // Start fresh so we know how many samples landed in the buffer.
      sampler.setPastBufferSampleRate(30);
      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();
      runtime.notifyExternalTimeUpdate(5.033);
      await runtime._drainForTests();

      const before = sampler.getRenderData("a1");
      expect(before).not.toBeNull();
      const lengthBefore = before!.pastBuffer.length;
      const newestBefore = before!.pastBuffer.newestTime;
      expect(lengthBefore).toBeGreaterThan(0);

      // Bump the rate — past samples should survive the reallocation.
      sampler.setPastBufferSampleRate(150);

      const after = sampler.getRenderData("a1");
      expect(after).not.toBeNull();
      expect(after!.pastBuffer.length).toBe(lengthBefore);
      expect(after!.pastBuffer.newestTime).toBe(newestBefore);
    });
  });


  describe("combined tick + project ABI path (spec: visualisation.md §5.2/§7.2)", () => {
    afterEach(() => {
      // Reset port-state flags so subsequent tests get the default
      // (combined export unavailable) shape.
      portState.supportsTickAndProject = false;
      portState.tickAndProject = vi.fn().mockResolvedValue(null);
    });

    it("uses tickAndProject when the port reports supportsTickAndProject:true", async () => {
      const tickAndProjectMock = vi.fn(async (
        outputs: string[],
        tickTime: number,
        projectEnd: number,
        numFutureSamples: number,
      ) => {
        const tickValues = new Map<string, number>();
        for (const name of outputs) tickValues.set(name, 0.5);
        const projectionSamples = new Map<string, Array<{ time: number; value: number }>>();
        if (numFutureSamples > 0) {
          const dt = numFutureSamples > 1 ? (projectEnd - tickTime) / (numFutureSamples - 1) : 0;
          for (const name of outputs) {
            const samples: Array<{ time: number; value: number }> = [];
            for (let i = 0; i < numFutureSamples; i++) {
              samples.push({ time: tickTime + dt * i, value: 0.7 });
            }
            projectionSamples.set(name, samples);
          }
        }
        return { tickValues, projectionSamples };
      });
      portState.supportsTickAndProject = true;
      portState.tickAndProject = tickAndProjectMock;

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockBatch = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      mockBatch.mockClear();
      tickAndProjectMock.mockClear();

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // The combined path: tickAndProject was called, the legacy
      // single-sample tick was NOT.
      expect(tickAndProjectMock).toHaveBeenCalled();
      const tickCall = mockBatch.mock.calls.find(
        ([_outputs, start, end, count]) => start === 5.0 && end === 5.0 && count === 1,
      );
      expect(tickCall).toBeUndefined();

      // Past + future buffers should have data.
      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();
      expect(renderData!.pastBuffer.length).toBeGreaterThan(0);
      expect(renderData!.futureBuffer).toBeDefined();
      expect(renderData!.futureBuffer!.length).toBeGreaterThan(0);
    });

    it("falls back to the legacy 2-call path when tickAndProject returns null", async () => {
      // Capability says yes but port returns null at call time
      // (e.g. binding present but invocation fails) — the sampler
      // must gracefully fall back.
      portState.supportsTickAndProject = true;
      portState.tickAndProject = vi.fn().mockResolvedValue(null);

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockBatch = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      mockBatch.mockClear();
      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // Legacy tick call should fire (start === end === 5.0, count 1).
      const tickCall = mockBatch.mock.calls.find(
        ([_outputs, start, end, count]) => start === 5.0 && end === 5.0 && count === 1,
      );
      expect(tickCall).toBeDefined();
      expect(tickCall![0]).toEqual(["bar", "a1"]);

      // Past buffer should be populated by the fallback path.
      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();
      expect(renderData!.pastBuffer.length).toBeGreaterThan(0);
    });

    it("populates both past and future buffers from a single combined call", async () => {
      const tickAndProjectMock = vi.fn(async (
        outputs: string[],
        tickTime: number,
        projectEnd: number,
        numFutureSamples: number,
      ) => {
        const tickValues = new Map<string, number>();
        for (const name of outputs) tickValues.set(name, 0.42);
        const projectionSamples = new Map<string, Array<{ time: number; value: number }>>();
        if (numFutureSamples > 0) {
          const dt = numFutureSamples > 1 ? (projectEnd - tickTime) / (numFutureSamples - 1) : 0;
          for (const name of outputs) {
            const samples: Array<{ time: number; value: number }> = [];
            for (let i = 0; i < numFutureSamples; i++) {
              samples.push({ time: tickTime + dt * i, value: 0.84 });
            }
            projectionSamples.set(name, samples);
          }
        }
        return { tickValues, projectionSamples };
      });
      portState.supportsTickAndProject = true;
      portState.tickAndProject = tickAndProjectMock;

      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();

      // Past: at least one sample at the tick time with value 0.42.
      expect(renderData!.pastBuffer.length).toBeGreaterThan(0);
      expect(renderData!.pastBuffer.newestTime).toBe(5.0);

      // Future: refilled on first frame, contents come from projection
      // samples (value 0.84).
      expect(renderData!.futureBuffer).toBeDefined();
      expect(renderData!.futureBuffer!.length).toBeGreaterThan(0);
    });
  });

  describe("adaptive quality lever 1: skip per-frame future edge push (spec: visualisation.md §1.7/§9.2)", () => {
    it("at pressure level 0, the per-frame far-edge call IS issued when coverage is sufficient", async () => {
      const adaptive = await import("./adaptiveQuality.ts");
      adaptive._resetForTests();

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockBatch = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      // First tick batch-refills the future buffer; subsequent ticks
      // (with sufficient coverage) take the far-edge branch.
      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      mockBatch.mockClear();
      runtime.notifyExternalTimeUpdate(5.05);
      await runtime._drainForTests();

      // The far-edge call is a single-sample window at the future edge.
      // Find any call whose start === end (i.e. the edge push).
      const edgeCall = mockBatch.mock.calls.find(
        ([_outputs, start, end, count]) =>
          start === end && count === 1 && start > 5.05,
      );
      expect(edgeCall).toBeDefined();
    });

    it("at pressure level >= 1, tickAndProject skips the far-edge push", async () => {
      const adaptive = await import("./adaptiveQuality.ts");
      adaptive._resetForTests();

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockBatch = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      // Prime: do an initial tick so the future buffer is populated and
      // subsequent ticks would otherwise take the far-edge branch.
      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // Drive into pressure level 1 (mild).
      for (let i = 0; i < adaptive.MILD_MISS_COUNT; i++) {
        adaptive.recordTickElapsed(adaptive.MISS_THRESHOLD_MS + 10);
      }
      expect(adaptive.getPressureLevel()).toBeGreaterThanOrEqual(1);

      mockBatch.mockClear();
      runtime.notifyExternalTimeUpdate(5.05);
      await runtime._drainForTests();

      // The tick still fires (start === end at t=5.05), but no far-edge
      // single-sample call should have been made (start > 5.05 with
      // start === end).
      const edgeCall = mockBatch.mock.calls.find(
        ([_outputs, start, end, count]) =>
          start === end && count === 1 && start > 5.05,
      );
      expect(edgeCall).toBeUndefined();

      adaptive._resetForTests();
    });

    it("with adaptiveQuality disabled, edge call IS still issued even at high raw pressure", async () => {
      const adaptive = await import("./adaptiveQuality.ts");
      adaptive._resetForTests();

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockBatch = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // Drive into severe pressure.
      for (let i = 0; i < adaptive.SEVERE_MISS_COUNT; i++) {
        adaptive.recordTickElapsed(adaptive.MISS_THRESHOLD_MS + 10);
      }
      expect(adaptive.getRawPressureLevel()).toBe(2);

      // Disable adaptive quality — pressure level reported as 0.
      adaptive.setAdaptiveQualityEnabled(false);
      expect(adaptive.getPressureLevel()).toBe(0);
      expect(adaptive.shouldSkipFutureEdgePush()).toBe(false);

      mockBatch.mockClear();
      runtime.notifyExternalTimeUpdate(5.05);
      await runtime._drainForTests();

      const edgeCall = mockBatch.mock.calls.find(
        ([_outputs, start, end, count]) =>
          start === end && count === 1 && start > 5.05,
      );
      expect(edgeCall).toBeDefined();

      adaptive._resetForTests();
    });
  });
});
