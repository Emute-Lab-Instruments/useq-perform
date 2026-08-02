/**
 * Witness runner verdict semantics (witnesses.md §2).
 *
 * The property that matters most here is negative: an unsupported step must
 * never produce a pass. §2.2 is explicit — "The runner must not skip a step it
 * does not understand and report the remainder green."
 */

import { describe, it, expect, vi } from "vitest";

import {
  DEFAULT_WITNESS_TOLERANCE,
  aggregateVerdict,
  isWitnessSupported,
  parseEvalResult,
  runWitness,
  runWitnesses,
  stepOp,
  summariseResults,
  unsupportedReason,
  witnessUnsupportedReason,
} from "./runner.ts";
import type { Witness, WitnessEngine, WitnessStep } from "./types.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeEngineOptions {
  /** code -> raw `useq_eval` return string. */
  evals?: Record<string, string>;
  /** `${output}@${time}` -> sampled value. */
  samples?: Record<string, number>;
  /** Default eval reply for codes not in `evals`. */
  defaultEval?: string;
  /** Default sample value for keys not in `samples`. */
  defaultSample?: number;
  throwOn?: { evaluate?: boolean; sampleOutput?: boolean; reset?: boolean };
}

function fakeEngine(options: FakeEngineOptions = {}) {
  const log: string[] = [];
  const engine: WitnessEngine = {
    async reset() {
      if (options.throwOn?.reset) throw new Error("instantiation failed");
      log.push("reset");
    },
    evaluate(code) {
      if (options.throwOn?.evaluate) throw new Error("wasm trap");
      log.push(`eval:${code}`);
      return options.evals?.[code] ?? options.defaultEval ?? "ok";
    },
    sampleOutput(output, time) {
      if (options.throwOn?.sampleOutput) throw new Error("wasm trap");
      log.push(`sample:${output}@${time}`);
      return options.samples?.[`${output}@${time}`] ?? options.defaultSample ?? 0;
    },
    dispose() {
      log.push("dispose");
    },
  };
  return { engine, log };
}

function witness(steps: WitnessStep[], name = "case"): Witness {
  return {
    name,
    specFile: "time.md",
    clause: "1.1",
    specRefs: [{ file: "time.md", clause: "1.1" }],
    tags: [],
    steps,
    sourcePath: "src-useq/test/conformance/time/basics.yaml",
  };
}

// ---------------------------------------------------------------------------

describe("parseEvalResult", () => {
  it("reads a numeric result", () => {
    expect(parseEvalResult("2.5")).toEqual({ ok: true, value: 2.5, text: "2.5" });
  });

  it("reads a value-less success", () => {
    expect(parseEvalResult("ok")).toEqual({ ok: true, value: null, text: "ok" });
  });

  it("recognises the WASM ABI error prefix", () => {
    const r = parseEvalResult("Error: Unknown name");
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
  });

  it("decodes the printf renderings of non-finite values", () => {
    expect(parseEvalResult("inf").value).toBe(Infinity);
    expect(parseEvalResult("-inf").value).toBe(-Infinity);
    expect(Number.isNaN(parseEvalResult("nan").value as number)).toBe(true);
  });
});

describe("step classification", () => {
  it("names the single operation of a step", () => {
    expect(stepOp({ eval: "(a1 1)" })).toBe("eval");
    expect(stepOp({ sample: { output: "a1", times: [0] } })).toBe("sample");
    expect(stepOp({ tick: 0 })).toBe("tick");
  });

  it("refuses a step with no recognised operation", () => {
    expect(stepOp({ comment: "hi" } as WitnessStep)).toBeNull();
    expect(unsupportedReason({ comment: "hi" } as WitnessStep)).toContain("no single recognised operation");
  });

  it("supports eval and sample (witnesses.md §2.1)", () => {
    expect(unsupportedReason({ eval: "(a1 1)" })).toBeNull();
    expect(unsupportedReason({ sample: { output: "a1", times: [0, 1] }, expect_values: [0, 1] })).toBeNull();
  });

  it.each(["tick", "clear", "health", "config"])("does not support the '%s' step kind", (op) => {
    const step = { [op]: op === "tick" ? 0 : true } as unknown as WitnessStep;
    expect(unsupportedReason(step)).toContain(`step kind '${op}'`);
  });

  it("does not support diagnostics expectations (deferred by witnesses.md §5.1)", () => {
    const reason = unsupportedReason({ eval: "(a1 (bogus))", expect_diagnostic: { category: "undefinedName" } });
    expect(reason).toContain("expect_diagnostic");
  });

  it("rejects a sample whose expect_values length disagrees with times", () => {
    const reason = unsupportedReason({ sample: { output: "a1", times: [0, 1] }, expect_values: [0] });
    expect(reason).toContain("length");
  });

  it("reports the first offending step index for the whole witness", () => {
    const w = witness([{ eval: "(a1 1)" }, { tick: 0.5 }, { sample: { output: "a1", times: [0] } }]);
    expect(witnessUnsupportedReason(w)).toContain("step 2");
    expect(isWitnessSupported(w)).toBe(false);
  });
});

describe("runWitness — passing cases", () => {
  it("passes when every sample matches", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 0, "a1@0.5": 1, "a1@1": 2 } });
    const result = runWitness(
      engine,
      witness([
        { eval: "(a1 (fast 2 t))" },
        { sample: { output: "a1", times: [0, 0.5, 1] }, expect_values: [0, 1, 2] },
      ]),
    );
    expect(result.verdict).toBe("pass");
    expect(result.steps.map((s) => s.verdict)).toEqual(["pass", "pass"]);
    expect(result.steps[1].actual).toEqual([0, 1, 2]);
  });

  it("passes an eval whose scratch value matches expect_value", () => {
    const { engine } = fakeEngine({ evals: { "(+ a 1)": "100" } });
    const result = runWitness(engine, witness([{ eval: "(+ a 1)", expect_value: 100 }]));
    expect(result.verdict).toBe("pass");
    expect(result.steps[0].actual).toEqual([100]);
  });

  it("passes an eval that fails when the witness expects a failure", () => {
    const { engine } = fakeEngine({ defaultEval: "Error: Unknown name" });
    const result = runWitness(engine, witness([{ eval: "(no-such-fn 1)", expect_error: true }]));
    expect(result.verdict).toBe("pass");
  });

  it("accepts either outcome under expect_error: allow (resilience doctrine)", () => {
    for (const reply of ["ok", "Error: boom"]) {
      const { engine } = fakeEngine({ defaultEval: reply });
      const result = runWitness(engine, witness([{ eval: "(weird)", expect_error: "allow" }]));
      expect(result.verdict).toBe("pass");
    }
  });
});

describe("runWitness — failing cases", () => {
  it("fails when a sampled value is outside tolerance", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 0.5 } });
    const result = runWitness(engine, witness([{ sample: { output: "a1", times: [0] }, expect_values: [0.25] }]));
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("got 0.5, want 0.25");
    expect(result.steps[0].expected).toEqual([0.25]);
  });

  it("fails when an eval errors and the witness expected success", () => {
    const { engine } = fakeEngine({ defaultEval: "Error: Unknown name" });
    const result = runWitness(engine, witness([{ eval: "(a1 (bogus))" }]));
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("eval failed");
  });

  it("fails when an eval succeeds but the witness expected a failure", () => {
    const { engine } = fakeEngine({ defaultEval: "ok" });
    const result = runWitness(engine, witness([{ eval: "(a1 1)", expect_error: true }]));
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("expects a failure");
  });

  it("fails when an eval returns no value but expect_value was set", () => {
    const { engine } = fakeEngine({ defaultEval: "ok" });
    const result = runWitness(engine, witness([{ eval: "(a1 1)", expect_value: 3 }]));
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("returned no value");
  });

  it("stops at the first failing step — later steps run on untrustworthy state", () => {
    const { engine, log } = fakeEngine({ samples: { "a1@0": 9 } });
    const result = runWitness(
      engine,
      witness([
        { sample: { output: "a1", times: [0] }, expect_values: [0] },
        { eval: "(a2 1)" },
      ]),
    );
    expect(result.verdict).toBe("fail");
    expect(result.steps).toHaveLength(1);
    expect(log).not.toContain("eval:(a2 1)");
  });
});

describe("runWitness — tolerance", () => {
  it("uses the native runner's default tolerance", () => {
    expect(DEFAULT_WITNESS_TOLERANCE).toBe(1e-9);
  });

  it("accepts a difference at exactly the default tolerance (inclusive, like the native runner)", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 1e-9 } });
    const result = runWitness(engine, witness([{ sample: { output: "a1", times: [0] }, expect_values: [0] }]));
    expect(result.verdict).toBe("pass");
  });

  it("rejects a difference just beyond the default tolerance", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 1.001e-9 } });
    const result = runWitness(engine, witness([{ sample: { output: "a1", times: [0] }, expect_values: [0] }]));
    expect(result.verdict).toBe("fail");
  });

  it("rejects a difference beyond the default tolerance", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 1 + 1e-6 } });
    const result = runWitness(engine, witness([{ sample: { output: "a1", times: [0] }, expect_values: [1] }]));
    expect(result.verdict).toBe("fail");
  });

  it("honours a per-step 'tol' override", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 1.001 } });
    const w = witness([{ sample: { output: "a1", times: [0] }, expect_values: [1], tol: 0.01 }]);
    expect(runWitness(engine, w).verdict).toBe("pass");
  });

  it("honours a runner-level tolerance override", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 1.001 } });
    const w = witness([{ sample: { output: "a1", times: [0] }, expect_values: [1] }]);
    expect(runWitness(engine, w, { defaultTolerance: 0.01 }).verdict).toBe("pass");
  });

  it("never treats NaN as equal to an expected value", () => {
    const { engine } = fakeEngine({ samples: { "a1@0": NaN } });
    const w = witness([{ sample: { output: "a1", times: [0] }, expect_values: [NaN as unknown as number] }]);
    expect(runWitness(engine, w).verdict).toBe("fail");
  });
});

describe("runWitness — unsupported (witnesses.md §2.2)", () => {
  it.each([
    ["tick", { tick: 0.5 }],
    ["clear", { clear: true }],
    ["health", { health: { output: "a1", expect: "running" } }],
    ["config", { config: { failure_mode: "zero" } }],
  ])("reports 'unsupported', never 'pass', for a %s step", (_label, step) => {
    const { engine } = fakeEngine({ samples: { "a1@0": 0 } });
    const result = runWitness(
      engine,
      witness([
        { eval: "(a1 0)" },
        step as WitnessStep,
        { sample: { output: "a1", times: [0] }, expect_values: [0] },
      ]),
    );
    expect(result.verdict).toBe("unsupported");
  });

  it("does not touch the engine at all when a witness is unsupported", () => {
    const { engine, log } = fakeEngine();
    const result = runWitness(engine, witness([{ eval: "(a1 0)" }, { tick: 1 }]));
    expect(result.verdict).toBe("unsupported");
    expect(log).toEqual([]);
  });

  it("marks an eval carrying a diagnostics expectation as unsupported, not passed", () => {
    const { engine } = fakeEngine({ defaultEval: "Error: Unknown name" });
    const result = runWitness(
      engine,
      witness([{ eval: "(a1 (bogus-fn 1))", expect_diagnostic: { category: "undefinedName", span: [5, 13] } }]),
    );
    expect(result.verdict).toBe("unsupported");
    expect(result.detail).toContain("expect_diagnostic");
  });

  it("explains which step is unsupported in the step results", () => {
    const { engine } = fakeEngine();
    const result = runWitness(engine, witness([{ eval: "(a1 0)" }, { tick: 1 }]));
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].detail).toBeUndefined();
    expect(result.steps[1].detail).toContain("tick");
  });
});

describe("runWitness — engine faults", () => {
  it("reports 'error' (not 'fail') when the engine throws", () => {
    const { engine } = fakeEngine({ throwOn: { evaluate: true } });
    const result = runWitness(engine, witness([{ eval: "(a1 1)" }]));
    expect(result.verdict).toBe("error");
    expect(result.detail).toContain("engine fault");
  });
});

describe("runWitnesses", () => {
  it("resets the engine before every supported witness (witnesses.md §2.3)", async () => {
    const { engine, log } = fakeEngine();
    await runWitnesses(engine, [witness([{ eval: "(a1 1)" }], "a"), witness([{ eval: "(a2 2)" }], "b")]);
    expect(log).toEqual(["reset", "eval:(a1 1)", "reset", "eval:(a2 2)"]);
  });

  it("does not pay the reset cost for unsupported witnesses", async () => {
    const { engine, log } = fakeEngine();
    await runWitnesses(engine, [witness([{ tick: 1 }], "a")]);
    expect(log).toEqual([]);
  });

  it("reports an engine-instantiation failure as 'error'", async () => {
    const { engine } = fakeEngine({ throwOn: { reset: true } });
    const [result] = await runWitnesses(engine, [witness([{ eval: "(a1 1)" }])]);
    expect(result.verdict).toBe("error");
    expect(result.detail).toContain("reset failed");
  });

  it("streams results through onResult for incremental UI updates", async () => {
    const { engine } = fakeEngine();
    const onResult = vi.fn();
    await runWitnesses(engine, [witness([{ eval: "(a1 1)" }], "a"), witness([{ eval: "(a2 1)" }], "b")], { onResult });
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("stops early when the abort signal is set", async () => {
    const { engine } = fakeEngine();
    const signal = { aborted: false };
    const results = await runWitnesses(
      engine,
      [witness([{ eval: "(a1 1)" }], "a"), witness([{ eval: "(a2 1)" }], "b")],
      { signal, onResult: () => { signal.aborted = true; } },
    );
    expect(results).toHaveLength(1);
  });
});

describe("summariseResults", () => {
  it("counts each verdict", async () => {
    const { engine } = fakeEngine({ samples: { "a1@0": 5 } });
    const results = await runWitnesses(engine, [
      witness([{ eval: "(a1 1)" }], "ok"),
      witness([{ sample: { output: "a1", times: [0] }, expect_values: [0] }], "bad"),
      witness([{ tick: 1 }], "grey"),
    ]);
    expect(summariseResults(results)).toEqual({ pass: 1, fail: 1, unsupported: 1, error: 0 });
  });
});

describe("aggregateVerdict (engine-ledger.md §3.1)", () => {
  const r = (verdict: "pass" | "fail" | "unsupported" | "error") => ({
    name: "x",
    verdict,
    steps: [],
    durationMs: 0,
  });

  it("is 'none' for a clause with no witnesses — a visible coverage gap", () => {
    expect(aggregateVerdict([])).toBe("none");
  });

  it("is 'unrun' while any witness of the clause has no result yet", () => {
    expect(aggregateVerdict([r("pass"), undefined])).toBe("unrun");
  });

  it("is green only when every witness ran and passed", () => {
    expect(aggregateVerdict([r("pass"), r("pass")])).toBe("pass");
  });

  it("goes red on any failure, even beside passes", () => {
    expect(aggregateVerdict([r("pass"), r("fail")])).toBe("fail");
  });

  it("prefers red over amber", () => {
    expect(aggregateVerdict([r("error"), r("fail")])).toBe("fail");
  });

  it("goes amber on a runner error with no failures", () => {
    expect(aggregateVerdict([r("pass"), r("error")])).toBe("error");
  });

  it("goes grey when any witness is unsupported — never green", () => {
    expect(aggregateVerdict([r("pass"), r("unsupported")])).toBe("unsupported");
  });
});
