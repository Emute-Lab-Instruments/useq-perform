import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { default_extensions } from "@nextjournal/clojure-mode";

import { buildRenderForProbe, computeProbeHighlights, defaultEvalExpressionAtTimes } from "./probeSampling.ts";
import { collectVisibleIndexedForms } from "../probeHelpers.ts";
import type { ProbeConfig, PersistedProbeSpec } from "./probeTypes.ts";

function config(evaluate: ProbeConfig["evalExpression"]): ProbeConfig {
  return {
    evalExpression: evaluate, evalExpressionAtTimes: async () => null,
    getRefreshIntervalMs: () => 33, getLineWidth: () => 2, getDefaultSamples: () => 3,
    getCurrentTime: () => 4, loadPersistedProbes: () => [], savePersistedProbes: () => {},
    removePersistedProbes: () => {}, probeSet: async () => -1, probeSample: async () => null,
    probeFree: async () => {}, isWasmEnabled: () => true,
  };
}
const probe: PersistedProbeSpec = {
  id: "probe", from: 0, to: 3, mode: "raw", depth: 0, maxDepth: 0,
  cachedCode: "bar", canvasWidth: 138, canvasHeight: 46, windowDurationMs: 1000,
};

describe("probe sampling failures", () => {
  it("does not turn an empty evaluator result into a zero waveform", async () => {
    const state = EditorState.create({ doc: "bar", extensions: default_extensions });
    const result = await buildRenderForProbe(config(async () => ""), state, probe, 4, { probeSampleCount: 3 });
    expect(result?.render.kind).toBe("text");
    expect(result?.render.text).toBe("nil");
    expect(result?.render.samples).toEqual([]);
  });

  it.each(["Error: bad", "{error}"])("retries the last valid expression for interpreter error %s", async (error) => {
    const state = EditorState.create({ doc: "bad", extensions: default_extensions });
    const result = await buildRenderForProbe(config(async (code) => code.includes("bad") ? error : "7"), state, probe, 4, { probeSampleCount: 3 });
    expect(result?.probe.cachedCode).toBe("bar");
    expect(result?.render.samples).toEqual([7, 7, 7]);
  });

  it("does not borrow the last index from an identical list in a different context", async () => {
    const doc = "(slow 2 (seq [1 2 3] bar))\n(fast 3 (seq [1 2 3] bar))";
    const state = EditorState.create({ doc, extensions: default_extensions });
    const forms = collectVisibleIndexedForms(state, [{ from: 0, to: doc.length }]);
    const port = config(async (code) => code.includes("slow") ? "0.8" : "Error: unavailable");
    const highlights = await computeProbeHighlights(port, state, forms, [], new Map(), new Map());
    expect(highlights).toHaveLength(1);
    expect(highlights[0].from).toBeLessThan(doc.indexOf("\n"));
  });
});

describe("probe batch sampling", () => {
  it("builds one eval-at-time vector and parses numeric samples", async () => {
    const evaluate = vi.fn(async () => "[1 2.5 3]");

    await expect(
      defaultEvalExpressionAtTimes(evaluate, "(slow 2 bar)", [0, 0.5, 1]),
    ).resolves.toEqual({ samples: [1, 2.5, 3], current: "3" });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith(
      "[(eval-at-time 0 (slow 2 bar)) (eval-at-time 0.5 (slow 2 bar)) (eval-at-time 1 (slow 2 bar))]",
    );
  });

  it("returns an empty result without evaluating an empty time vector", async () => {
    const evaluate = vi.fn(async () => "unexpected");
    await expect(defaultEvalExpressionAtTimes(evaluate, "bar", [])).resolves.toEqual({
      samples: [],
      current: "",
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it.each([
    "Error: failed",
    "not-a-vector",
    "[1 2]",
    "[1 nope 3]",
  ])("rejects a non-conforming batch result: %s", async (result) => {
    await expect(
      defaultEvalExpressionAtTimes(async () => result, "bar", [0, 0.5, 1]),
    ).resolves.toBeNull();
  });

  it("turns evaluator failure into the documented fallback signal", async () => {
    await expect(
      defaultEvalExpressionAtTimes(async () => {
        throw new Error("unavailable");
      }, "bar", [0]),
    ).resolves.toBeNull();
  });
});
