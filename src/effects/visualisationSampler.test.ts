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

      // The difference between starts should be a multiple of the step size
      const step = 10 / 99;
      const diff = Math.abs(call2Start - call1Start);
      // Either same grid point or exactly one step apart
      expect(diff < 1e-9 || Math.abs(diff - step) < 1e-9 || Math.abs(diff % step) < 1e-9).toBe(true);
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
});
