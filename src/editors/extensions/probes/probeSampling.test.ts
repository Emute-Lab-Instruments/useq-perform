import { describe, expect, it, vi } from "vitest";

import { defaultEvalExpressionAtTimes } from "./probeSampling.ts";

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
