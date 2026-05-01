/**
 * Regression tests for the visualisation sampling boundary.
 *
 * After consolidation (`bd useq-perform-7hs`) sampling state lives in
 * `visualisationRuntime`; the sampler module exposes pure helpers
 * (`registerVisualisation`, `rebuildAllExpressions`, etc.).  These tests
 * cover both modules through their public API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../runtime/wasmInterpreter.ts", () => ({
  evalInUseqWasm: vi.fn().mockResolvedValue("0.5"),
  updateUseqWasmTime: vi.fn().mockResolvedValue(undefined),
  evalOutputAtTime: vi.fn().mockResolvedValue(0.5),
  evalOutputsInTimeWindow: vi.fn().mockImplementation(
    (exprTypes: string[], start: number, end: number, count: number) => {
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
    },
  ),
  readActiveDiagnostics: vi.fn().mockReturnValue([]),
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

// Stub out the renderer + diag store so the runtime can `notifyExternalTimeUpdate`
// without a DOM canvas or output-health side effects.
vi.mock("../ui/visualisation/serialVis.ts", () => ({
  drawSerialVis: vi.fn(),
  ensureCanvasGeometry: vi.fn(),
  isVisPanelVisible: vi.fn().mockReturnValue(false),
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
      const { evalOutputAtTime } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockOutput = vi.mocked(evalOutputAtTime);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      mockOutput.mockClear();
      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // Tick calls evalOutputAtTime to advance state
      expect(mockOutput).toHaveBeenCalledWith("a1", 5.0);

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
});
