/**
 * Tests for the devmode-only browser eval surface.
 *
 * The ordered first-sound browser journey (VAL-CROSS-001..009/013) needs
 * a verified route to trigger the production `evaluate()` function from
 * agent-browser. Prior evidence used a synthetic `KeyboardEvent` dispatched
 * via `dispatchEvent`, which is not a trusted event and silently failed
 * for several evals, so later steps could not prove the synth committed.
 *
 * The devmode surface in this module routes through the real production
 * `evaluate(view, "toplevel")` path (the same function the
 * `eval.quantised` keymap handler calls) and returns the post-eval
 * synthesis telemetry so the caller can assert revision/epoch changes
 * before advancing.
 *
 * These tests run in jsdom with the production `evaluate()` mocked so we
 * can prove the surface routes through it and returns the correlated
 * snapshot.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Production evaluate() must be called — this is the whole point. We
// use vi.hoisted so the mock factory can reference the spy without
// tripping the "top level variables" hoist guard.
const {
  evaluateMock,
  editorAccessorMock,
  telemetryAccessorMock,
  sampleOutputAtTimeMock,
} = vi.hoisted(() => ({
  evaluateMock: vi.fn((_view: unknown, _strategy: string) => true),
  editorAccessorMock: vi.fn<[], unknown>(() => null),
  telemetryAccessorMock: vi.fn<[], unknown>(() => null),
  sampleOutputAtTimeMock: vi.fn(async (_name: string, _time: number) => 0),
}));

vi.mock("../effects/editorEvaluation", () => ({
  evaluate: evaluateMock,
}));

// Stub editorStore so tests can inject the active EditorView.
vi.mock("../lib/editorStore", () => ({
  editorSession: { get view() { return editorAccessorMock(); } },
}));

// Stub activeSynthesisService so tests can inject telemetry.
vi.mock("../runtime/activeSynthesisService", () => ({
  getActiveSynthesisService: () => telemetryAccessorMock(),
}));

vi.mock("../runtime/activeWasmRuntimePort", () => ({
  getActiveWasmRuntimePort: () => ({
    evalOutputAtTime: sampleOutputAtTimeMock,
  }),
}));

import {
  installBrowserEvalSurface,
  teardownBrowserEvalSurface,
  type BrowserEvalSurface,
} from "./browserEvalSurface";

// ---------------------------------------------------------------------------
// Helpers — install a fake surface on a plain window-like object.
// ---------------------------------------------------------------------------

interface TestWindow {
  __useqBrowserEval?: BrowserEvalSurface;
}

function freshWindow(): TestWindow {
  return {};
}

describe("browserEvalSurface (devmode-only verified eval route)", () => {
  beforeEach(() => {
    evaluateMock.mockReset();
    evaluateMock.mockReturnValue(true);
    editorAccessorMock.mockReset();
    editorAccessorMock.mockReturnValue(null);
    telemetryAccessorMock.mockReset();
    telemetryAccessorMock.mockReturnValue(null);
    sampleOutputAtTimeMock.mockReset();
    sampleOutputAtTimeMock.mockResolvedValue(0);
  });

  afterEach(() => {
    teardownBrowserEvalSurface(freshWindow());
  });

  describe("installBrowserEvalSurface", () => {
    it("installs window.__useqBrowserEval on the provided window", () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      expect(w.__useqBrowserEval).toBeDefined();
      expect(typeof w.__useqBrowserEval?.evalToplevelNow).toBe("function");
      expect(typeof w.__useqBrowserEval?.sampleOutputAtTime).toBe("function");
    });

    it("does not install the surface when window is undefined (SSR safety)", () => {
      // Passing undefined simulates a non-browser environment.
      // Should not throw.
      expect(() => installBrowserEvalSurface(undefined as unknown as TestWindow)).not.toThrow();
    });
  });

  describe("sampleOutputAtTime", () => {
    it("observes output through the active production WASM port", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      sampleOutputAtTimeMock.mockResolvedValue(0.375);

      await expect(
        w.__useqBrowserEval!.sampleOutputAtTime("a1", 1.25),
      ).resolves.toBe(0.375);
      expect(sampleOutputAtTimeMock).toHaveBeenCalledWith("a1", 1.25);
    });
  });

  describe("teardownBrowserEvalSurface", () => {
    it("removes the installed surface", () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      expect(w.__useqBrowserEval).toBeDefined();
      teardownBrowserEvalSurface(w);
      expect(w.__useqBrowserEval).toBeUndefined();
    });
  });

  describe("evalToplevelNow", () => {
    it("returns an explicit error when no editor view is mounted", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      editorAccessorMock.mockReturnValue(null);
      const result = w.__useqBrowserEval!.evalToplevelNow();
      const resolved = await Promise.resolve(result);
      expect(resolved.ok).toBe(false);
      expect(typeof resolved.error).toBe("string");
      expect(evaluateMock).not.toHaveBeenCalled();
    });

    it("places the cursor inside the first top-level form before evaluating", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      const fakeView = {
        state: { doc: { length: 25 } },
        dispatch: vi.fn(),
      };
      editorAccessorMock.mockReturnValue(fakeView);
      const result = w.__useqBrowserEval!.evalToplevelNow();
      await Promise.resolve(result);

      // Cursor must be placed via a selection transaction so the
      // top-level form lookup sees the intended form. We assert at least
      // one dispatch happened carrying a selection effect/transaction.
      expect(fakeView.dispatch).toHaveBeenCalled();
      const calls = fakeView.dispatch.mock.calls;
      const hasSelection = calls.some(
        (call: unknown[]) => {
          const arg = call[0] as { selection?: unknown } | undefined;
          return arg && typeof arg === "object" && "selection" in arg;
        },
      );
      expect(hasSelection).toBe(true);
    });

    it("routes through the production evaluate() function with strategy 'toplevel'", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      const fakeView = {
        state: { doc: { length: 25 } },
        dispatch: vi.fn(),
      };
      editorAccessorMock.mockReturnValue(fakeView);
      await Promise.resolve(w.__useqBrowserEval!.evalToplevelNow());

      expect(evaluateMock).toHaveBeenCalledTimes(1);
      const [viewArg, strategyArg] = evaluateMock.mock.calls[0];
      expect(viewArg).toBe(fakeView);
      expect(strategyArg).toBe("toplevel");
    });

    it("returns evalAccepted=false when the production evaluate() returns false", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      const fakeView = {
        state: { doc: { length: 25 } },
        dispatch: vi.fn(),
      };
      editorAccessorMock.mockReturnValue(fakeView);
      evaluateMock.mockReturnValue(false);

      const result = await Promise.resolve(w.__useqBrowserEval!.evalToplevelNow());
      expect(result.ok).toBe(true);
      expect(result.evalAccepted).toBe(false);
    });

    it("returns the correlated post-eval telemetry snapshot when eval accepted", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      const fakeView = {
        state: { doc: { length: 25 } },
        dispatch: vi.fn(),
      };
      editorAccessorMock.mockReturnValue(fakeView);
      const fakeTelemetry = {
        programRevision: 3,
        activeEpoch: 2,
        pendingEpoch: 0,
        instanceId: "::anon-0",
        engineState: "running",
        peakSample: 0.2,
        rmsSample: 0.14,
        finiteOutput: 1,
      };
      telemetryAccessorMock.mockReturnValue({ telemetry: fakeTelemetry });

      const result = await Promise.resolve(w.__useqBrowserEval!.evalToplevelNow());
      expect(result.ok).toBe(true);
      expect(result.evalAccepted).toBe(true);
      expect(result.telemetry).toEqual(fakeTelemetry);
      expect(result.telemetry?.programRevision).toBe(3);
      expect(result.telemetry?.activeEpoch).toBe(2);
    });

    it("returns telemetry=null when no synthesis service is available (degraded profile)", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      const fakeView = {
        state: { doc: { length: 25 } },
        dispatch: vi.fn(),
      };
      editorAccessorMock.mockReturnValue(fakeView);
      telemetryAccessorMock.mockReturnValue(null);

      const result = await Promise.resolve(w.__useqBrowserEval!.evalToplevelNow());
      expect(result.ok).toBe(true);
      expect(result.evalAccepted).toBe(true);
      expect(result.telemetry).toBeNull();
    });

    it("returns ok=false with an error message when evaluate() throws", async () => {
      const w = freshWindow();
      installBrowserEvalSurface(w);
      const fakeView = {
        state: { doc: { length: 25 } },
        dispatch: vi.fn(),
      };
      editorAccessorMock.mockReturnValue(fakeView);
      evaluateMock.mockImplementation(() => {
        throw new Error("boom");
      });

      const result = await Promise.resolve(w.__useqBrowserEval!.evalToplevelNow());
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error).toContain("boom");
    });
  });
});
