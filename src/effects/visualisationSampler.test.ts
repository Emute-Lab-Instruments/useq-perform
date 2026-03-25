/**
 * Regression tests for visualisation sampler.
 *
 * These tests cover bugs found during the Phase 6 refactor:
 * - Race condition when registering 3+ expressions concurrently
 * - Sample grid alignment for jitter-free rendering
 * - Time/sampling decoupling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock WASM interpreter before importing sampler
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
}));

// Mock appSettingsRepository
vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn().mockReturnValue({ visualisation: {} }),
  subscribeAppSettings: vi.fn().mockReturnValue(() => {}),
}));

// Mock visualisationUtils
vi.mock("../lib/visualisationUtils.ts", () => ({
  getSerialVisPalette: vi.fn().mockReturnValue(["#ff0000", "#00ff00", "#0000ff"]),
  getSerialVisChannelColor: vi.fn().mockReturnValue("#ff0000"),
}));

// Mock channels
vi.mock("../contracts/runtimeChannels", () => ({
  codeEvaluated: { subscribe: vi.fn() },
}));

vi.mock("../contracts/visualisationChannels", () => ({
  serialVisPaletteChangedChannel: { subscribe: vi.fn() },
  visualisationSessionChannel: { publish: vi.fn() },
}));

describe("visualisationSampler", () => {
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
      const { visStore } = await import("../utils/visualisationStore.ts");

      // Register two expressions
      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      await sampler.registerVisualisation("a2", "(a2 (sin 2))");

      // Now register a third — this should not lose a1 or a2
      await sampler.registerVisualisation("d1", "(d1 (square 1))");

      // Trigger a rebuild (simulating notifyExpressionEvaluated)
      sampler.notifyExpressionEvaluated();

      // Wait for async rebuild to complete
      await new Promise((r) => setTimeout(r, 50));

      // All three must still be present
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

  describe("sample grid alignment (regression: vertical jitter)", () => {
    it("snaps sample window start to step grid", async () => {
      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const mockEval = vi.mocked(evalOutputsInTimeWindow);

      // Register an expression, then trigger a time update at a non-grid-aligned time
      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      mockEval.mockClear();
      await sampler.handleExternalTimeUpdate(5.037); // arbitrary non-aligned time

      const lastCall = mockEval.mock.calls[mockEval.mock.calls.length - 1];
      const [, start] = lastCall;

      // Default: windowDuration=10, sampleCount=100, step=10/99≈0.10101
      // The start should be snapped to a multiple of step
      const step = 10 / 99;
      const snappedStart = Math.floor(start / step) * step;
      // The actual start should be exactly on the grid
      expect(Math.abs(start - snappedStart)).toBeLessThan(1e-9);
    });

    it("produces consistent sample times across slightly different currentTimes", async () => {
      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const mockEval = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      // Simulate two time ticks very close together (as would happen between frames)
      mockEval.mockClear();
      await sampler.handleExternalTimeUpdate(5.016);
      const call1Start = mockEval.mock.calls[0]?.[1];

      mockEval.mockClear();
      await sampler.handleExternalTimeUpdate(5.033);
      const call2Start = mockEval.mock.calls[0]?.[1];

      // With deduped sampling, the second rebuild may be skipped entirely if
      // the snapped sampling window is unchanged.
      if (call2Start == null) {
        expect(mockEval).not.toHaveBeenCalled();
        return;
      }

      // Otherwise the difference between starts should be a multiple of the
      // step size.
      const step = 10 / 99;
      const diff = Math.abs(call2Start - call1Start);
      // Either same grid point or exactly one step apart.
      expect(diff < 1e-9 || Math.abs(diff - step) < 1e-9 || Math.abs(diff % step) < 1e-9).toBe(true);
    });

    it("skips rebuilding when consecutive ticks land in the same snapped window", async () => {
      const { evalOutputsInTimeWindow, evalOutputAtTime } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const mockEvalWindow = vi.mocked(evalOutputsInTimeWindow);
      const mockEvalOutput = vi.mocked(evalOutputAtTime);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      mockEvalWindow.mockClear();
      mockEvalOutput.mockClear();

      await sampler.handleExternalTimeUpdate(5.016);
      await sampler.handleExternalTimeUpdate(5.033);

      expect(mockEvalWindow).toHaveBeenCalledTimes(1);
      expect(mockEvalOutput).toHaveBeenCalledTimes(2);
    });

    it("rebuilds once the snapped sampling window advances", async () => {
      const { evalOutputsInTimeWindow, evalOutputAtTime } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const mockEvalWindow = vi.mocked(evalOutputsInTimeWindow);
      const mockEvalOutput = vi.mocked(evalOutputAtTime);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      mockEvalWindow.mockClear();
      mockEvalOutput.mockClear();

      await sampler.handleExternalTimeUpdate(5.016);
      await sampler.handleExternalTimeUpdate(5.130);

      expect(mockEvalWindow).toHaveBeenCalledTimes(2);
      expect(mockEvalOutput).toHaveBeenCalledTimes(2);
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

  describe("handleExternalTimeUpdate (regression: decoupled time/sampling)", () => {
    it("does not call updateTime (callers handle time)", async () => {
      const { updateTime } = await import("../utils/visualisationStore.ts");
      const { handleExternalTimeUpdate } = await import(
        "./visualisationSampler.ts"
      );

      // Spy on updateTime
      const spy = vi.spyOn(
        await import("../utils/visualisationStore.ts"),
        "updateTime",
      );

      await handleExternalTimeUpdate(1.0);

      // handleExternalTimeUpdate should NOT call updateTime directly
      // (callers: localClock and stream-parser do this)
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
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
      const previousSamples = visStore.expressions.a1?.samples;
      mockEval.mockRejectedValueOnce(new Error("bad expression"));
      mockEval.mockRejectedValueOnce(new Error("restore failed"));

      await refreshVisualisedExpression("a1", "(a1 (/ 1 0", { from: 4, to: 4 });

      expect(visStore.expressions.a1).toMatchObject({
        expressionText: "(a1 beat)",
        position: { from: 4, to: 4 },
      });
      expect(visStore.expressions.a1?.samples).toBe(previousSamples);
      expect(mockEvalWindow).not.toHaveBeenCalled();
    });
  });
});
