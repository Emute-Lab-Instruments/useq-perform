/**
 * Witness runner against the **real bundled WASM engine** (engine-ledger.md
 * §5.2 — "the aggregate whole-corpus run matches the native runner's verdicts
 * on the same pinned submodule, spot-checked in tests against a fixture
 * subset").
 *
 * This is the test that would actually catch spec/engine drift, so it runs
 * the shipped artefact rather than a fake. It is skipped when
 * `public/wasm/useq.{js,wasm}` are absent (they are gitignored build outputs,
 * produced by `npm run build:wasm`), and reported as skipped rather than
 * silently green.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";

import { createNodeWitnessEngine, wasmArtefactsAvailable } from "./nodeEngine.testkit.ts";
import { isWitnessSupported, runWitness, runWitnesses, summariseResults } from "./runner.ts";
import { parseWitnessIndex } from "./loader.ts";
import type { Witness, WitnessEngine, WitnessIndex } from "./types.ts";

const INDEX_PATH = "public/assets/witness-index.json";
const available = wasmArtefactsAvailable() && fs.existsSync(INDEX_PATH);

describe.runIf(available)("witness runner against the bundled WASM engine", () => {
  let engine: WitnessEngine;
  let index: WitnessIndex;

  const byName = (name: string): Witness => {
    const w = index.witnesses.find((x) => x.name === name);
    if (!w) throw new Error(`fixture witness '${name}' is not in the corpus`);
    return w;
  };

  const run = async (name: string) => {
    const w = byName(name);
    await engine.reset();
    return runWitness(engine, w);
  };

  beforeAll(async () => {
    index = parseWitnessIndex(JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")));
    engine = await createNodeWitnessEngine();
  }, 60_000);

  // --- Fixture subset: one supported witness per spec area that has them ---

  it.each([
    "fast-is-pointwise-time-scaling",
    "slow-is-pointwise-time-division",
    "nested-warps-compose",
    "time-as-rebinds-phasors",
    "scratch-eval-keeps-fresh-init",
    "set-with-stateful-rhs-is-isolated",
    "failed-defstate-rolls-back-binding",
  ])("passes %s — the shipped engine agrees with the spec", async (name) => {
    const result = await run(name);
    expect(result.verdict, result.detail).toBe("pass");
  });

  it("evaluates a real time-warp witness to the exact expected samples", async () => {
    const result = await run("fast-is-pointwise-time-scaling");
    const sampleStep = result.steps.find((s) => s.op === "sample");
    expect(sampleStep?.actual).toEqual([0, 1, 2]);
    expect(sampleStep?.expected).toEqual([0, 1, 2]);
  });

  it("reports a diagnostics witness as unsupported, never as a pass", async () => {
    const result = await run("undefined-name-category-and-span");
    expect(result.verdict).toBe("unsupported");
  });

  it("reports a tick-dependent failure-model witness as unsupported", async () => {
    const result = await run("lkg-fallback-on-non-finite-root");
    expect(result.verdict).toBe("unsupported");
  });

  // --- Isolation (witnesses.md §2.3) ---

  it("isolates witnesses from each other — a fresh engine per case", async () => {
    await engine.reset();
    expect(engine.evaluate("(define isolation-probe 7)").startsWith("Error")).toBe(false);
    expect(engine.evaluate("(+ isolation-probe 0)")).toBe("7");

    await engine.reset();
    // A new instantiation must not carry the previous cell definition.
    expect(engine.evaluate("(+ isolation-probe 0)").startsWith("Error")).toBe(true);
  });

  it("samples without advancing engine state (witnesses.md §2.4)", async () => {
    await engine.reset();
    engine.evaluate("(a1 (fast 2 t))");
    const first = [0, 0.5, 1].map((t) => engine.sampleOutput("a1", t));
    const second = [0, 0.5, 1].map((t) => engine.sampleOutput("a1", t));
    expect(second).toEqual(first);
    expect(first).toEqual([0, 1, 2]);
  });

  // --- Whole-corpus aggregate ---

  it("runs the whole corpus with no failures and no runner errors", async () => {
    const results = await runWitnesses(engine, index.witnesses);
    const counts = summariseResults(results);

    const problems = results
      .filter((r) => r.verdict === "fail" || r.verdict === "error")
      .map((r) => `${r.verdict.toUpperCase()} ${r.name}: ${r.detail}`);

    // A red witness means the shipped engine and the spec disagree
    // (engine-ledger.md §3.1). Surface which one, not just the count.
    expect(problems, problems.join("\n")).toEqual([]);
    expect(counts.fail).toBe(0);
    expect(counts.error).toBe(0);
    expect(counts.pass + counts.unsupported).toBe(index.witnessCount);
    expect(counts.pass).toBeGreaterThan(0);
  }, 120_000);

  it("runs every witness the runner claims to support", async () => {
    const results = await runWitnesses(engine, index.witnesses);
    for (const [i, result] of results.entries()) {
      const witness = index.witnesses[i];
      expect(result.verdict === "unsupported").toBe(!isWitnessSupported(witness));
    }
  }, 120_000);
});

describe.skipIf(available)("witness runner against the bundled WASM engine", () => {
  it.skip("skipped — build the WASM artefacts and assets first (npm run build)", () => {});
});
