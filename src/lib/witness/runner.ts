/**
 * In-app witness runner.
 *
 * Spec: `docs/specs/witnesses.md` §2.
 *
 * Drives conformance witnesses against an injected, isolated engine
 * (`WitnessEngine`). The runner supports the `eval` and `sample` step kinds
 * required by §2.1. Every other step kind — and every expectation the runner
 * cannot faithfully check — makes the whole witness `unsupported` (§2.2).
 * Support is decided **before** anything is evaluated, so a witness is never
 * half-run and reported green.
 *
 * Foundation layer: no imports from runtime/effects/ui/editors/transport.
 */

import type {
  ClauseVerdict,
  Witness,
  WitnessEngine,
  WitnessResult,
  WitnessRunnerConfig,
  WitnessStep,
  WitnessStepResult,
  WitnessVerdict,
} from "./types.ts";

/**
 * Absolute float tolerance. Mirrors `DEFAULT_TOL` in the native runner,
 * `src-useq/scripts/run_conformance.py`.
 */
export const DEFAULT_WITNESS_TOLERANCE = 1e-9;

/** Every step operation the corpus vocabulary defines. */
const STEP_OPS = ["eval", "tick", "sample", "clear", "health", "config"] as const;

/** The subset this runner executes (witnesses.md §2.1). */
const SUPPORTED_OPS: ReadonlySet<string> = new Set(["eval", "sample"]);

/**
 * Expectations the runner cannot faithfully check yet.
 *
 * `expect_diagnostic` needs the structured diagnostics readback and is
 * explicitly deferred by witnesses.md §5.1. Checking only the pass/fail of
 * such an eval would be a false pass, so the witness is reported
 * `unsupported` instead.
 */
const UNSUPPORTED_EXPECTATIONS = ["expect_diagnostic"] as const;

/** The operation key of a step, or `null` when it has none. */
export function stepOp(step: WitnessStep): string | null {
  const ops = STEP_OPS.filter((op) => Object.prototype.hasOwnProperty.call(step, op));
  return ops.length === 1 ? ops[0] : null;
}

/**
 * Why the runner cannot execute a step, or `null` when it can.
 * Exported so the UI can explain a grey badge precisely.
 */
export function unsupportedReason(step: WitnessStep): string | null {
  const op = stepOp(step);
  if (op === null) {
    return "step has no single recognised operation";
  }
  if (!SUPPORTED_OPS.has(op)) {
    return `step kind '${op}' is not supported by the in-app runner (witnesses.md §5.1)`;
  }
  for (const key of UNSUPPORTED_EXPECTATIONS) {
    if (Object.prototype.hasOwnProperty.call(step, key)) {
      return `expectation '${key}' is not supported by the in-app runner (witnesses.md §5.1)`;
    }
  }
  if (op === "sample") {
    const spec = step.sample;
    if (!spec || typeof spec.output !== "string" || !Array.isArray(spec.times)) {
      return "malformed 'sample' step (needs {output, times: [...]})";
    }
    if (step.expect_values && step.expect_values.length !== spec.times.length) {
      return "'expect_values' length does not match 'times' length";
    }
  }
  if (op === "eval" && typeof step.eval !== "string") {
    return "malformed 'eval' step (code must be a string)";
  }
  return null;
}

/** The first unsupported reason across a witness's steps, or `null`. */
export function witnessUnsupportedReason(witness: Witness): string | null {
  for (const [index, step] of witness.steps.entries()) {
    const reason = unsupportedReason(step);
    if (reason) return `step ${index + 1}: ${reason}`;
  }
  return null;
}

/** True when the runner can execute every step of this witness. */
export function isWitnessSupported(witness: Witness): boolean {
  return witnessUnsupportedReason(witness) === null;
}

/**
 * Parse a raw `useq_eval` result string.
 *
 * The WASM ABI returns `"Error: …"` for `EvalResult::Error`, `"ok"` for a
 * value-less success, and a `%.15g` rendering for a numeric result
 * (`src-useq/wasm/wasm_wrapper.cpp`).
 */
export function parseEvalResult(raw: string): {
  ok: boolean;
  value: number | null;
  text: string;
} {
  const text = String(raw ?? "").trim();
  if (text.startsWith("Error:") || text.startsWith("Error ")) {
    return { ok: false, value: null, text };
  }
  const value = parseNumericResult(text);
  return { ok: true, value, text };
}

function parseNumericResult(text: string): number | null {
  const lowered = text.toLowerCase();
  if (lowered === "inf" || lowered === "+inf" || lowered === "infinity") return Infinity;
  if (lowered === "-inf" || lowered === "-infinity") return -Infinity;
  if (lowered === "nan" || lowered === "-nan") return NaN;
  if (text === "") return null;
  const n = Number(text);
  return Number.isNaN(n) ? null : n;
}

function approxEqual(got: number, want: number, tol: number): boolean {
  if (Number.isNaN(got) || Number.isNaN(want)) return false;
  if (got === want) return true; // covers ±Infinity
  return Math.abs(got - want) <= tol;
}

function pass(index: number, op: string, extra: Partial<WitnessStepResult> = {}): WitnessStepResult {
  return { index, op, verdict: "pass", ...extra };
}

function fail(index: number, op: string, detail: string, extra: Partial<WitnessStepResult> = {}): WitnessStepResult {
  return { index, op, verdict: "fail", detail, ...extra };
}

/** Execute one supported step. Callers must have checked `unsupportedReason`. */
function runStep(engine: WitnessEngine, step: WitnessStep, index: number, defaultTol: number): WitnessStepResult {
  const op = stepOp(step) as "eval" | "sample";
  const tol = typeof step.tol === "number" ? step.tol : defaultTol;

  if (op === "eval") {
    const code = step.eval as string;
    const result = parseEvalResult(engine.evaluate(code));

    // Resilience mode: either outcome is acceptable as long as the engine
    // responded at all (run_conformance.py, `expect_error: allow`).
    if (step.expect_error === "allow") {
      return pass(index, op, { actual: result.value === null ? undefined : [result.value] });
    }

    const expectFailure = step.expect_error === true;
    if (expectFailure) {
      return result.ok
        ? fail(index, op, `eval succeeded but the witness expects a failure: ${code}`)
        : pass(index, op);
    }

    if (!result.ok) {
      return fail(index, op, `eval failed: ${code} -> ${result.text}`);
    }

    if (step.expect_value !== undefined) {
      if (result.value === null) {
        return fail(index, op, `eval returned no value (${result.text || "<empty>"}); expected ${step.expect_value}`, {
          expected: [Number(step.expect_value)],
        });
      }
      const want = Number(step.expect_value);
      return approxEqual(result.value, want, tol)
        ? pass(index, op, { actual: [result.value], expected: [want] })
        : fail(index, op, `eval value ${result.value} != ${want} (tol ${tol})`, {
            actual: [result.value],
            expected: [want],
          });
    }

    return pass(index, op, { actual: result.value === null ? undefined : [result.value] });
  }

  // op === "sample"
  const spec = step.sample!;
  const actual: number[] = [];
  for (const time of spec.times) {
    actual.push(engine.sampleOutput(spec.output, Number(time)));
  }

  if (!step.expect_values) {
    const unassigned = actual.some((v) => Number.isNaN(v));
    return unassigned
      ? fail(index, op, `sampling ${spec.output} produced NaN — the output is probably unassigned`, { actual })
      : pass(index, op, { actual });
  }

  const expected = step.expect_values.map((v) => Number(v));
  for (let i = 0; i < expected.length; i++) {
    if (!approxEqual(actual[i], expected[i], tol)) {
      return fail(
        index,
        op,
        `${spec.output} at t=${spec.times[i]}: got ${actual[i]}, want ${expected[i]} (tol ${tol})`,
        { actual, expected },
      );
    }
  }
  return pass(index, op, { actual, expected });
}

/**
 * Run one witness against an isolated engine.
 *
 * The caller owns engine isolation and is responsible for resetting the
 * engine before each witness (see `runWitnesses`).
 */
export function runWitness(
  engine: WitnessEngine,
  witness: Witness,
  config: WitnessRunnerConfig = {},
): WitnessResult {
  const started = now();
  const defaultTol = config.defaultTolerance ?? DEFAULT_WITNESS_TOLERANCE;

  const unsupported = witnessUnsupportedReason(witness);
  if (unsupported) {
    return {
      name: witness.name,
      verdict: "unsupported",
      detail: unsupported,
      steps: witness.steps.map((step, index) => ({
        index,
        op: stepOp(step) ?? "unknown",
        verdict: "unsupported" as WitnessVerdict,
        detail: unsupportedReason(step) ?? undefined,
      })),
      durationMs: now() - started,
    };
  }

  const steps: WitnessStepResult[] = [];
  let verdict: WitnessVerdict = "pass";
  let detail: string | undefined;

  for (const [index, step] of witness.steps.entries()) {
    let result: WitnessStepResult;
    try {
      result = runStep(engine, step, index, defaultTol);
    } catch (e) {
      result = {
        index,
        op: stepOp(step) ?? "unknown",
        verdict: "error",
        detail: `engine fault: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    steps.push(result);
    if (result.verdict !== "pass") {
      verdict = result.verdict;
      detail = result.detail;
      break; // the engine's state is no longer trustworthy for later steps
    }
  }

  return { name: witness.name, verdict, detail, steps, durationMs: now() - started };
}

/**
 * Run a batch of witnesses, resetting the engine between each one.
 *
 * Isolation between witnesses is mandatory (witnesses.md §2.3) — the engine
 * carries cells, state slots and output assignments across evals, so a stale
 * engine would make results order-dependent.
 */
export async function runWitnesses(
  engine: WitnessEngine,
  witnesses: readonly Witness[],
  config: WitnessRunnerConfig = {},
): Promise<WitnessResult[]> {
  const results: WitnessResult[] = [];
  for (const witness of witnesses) {
    if (config.signal?.aborted) break;

    // Unsupported witnesses never touch the engine, so skip the reset cost.
    let result: WitnessResult;
    if (!isWitnessSupported(witness)) {
      result = runWitness(engine, witness, config);
    } else {
      try {
        await engine.reset();
      } catch (e) {
        result = {
          name: witness.name,
          verdict: "error",
          detail: `engine reset failed: ${e instanceof Error ? e.message : String(e)}`,
          steps: [],
          durationMs: 0,
        };
        results.push(result);
        config.onResult?.(result);
        continue;
      }
      result = runWitness(engine, witness, config);
    }

    results.push(result);
    config.onResult?.(result);
  }
  return results;
}

/** Count verdicts across a set of results. */
export function summariseResults(results: readonly WitnessResult[]): Record<WitnessVerdict, number> {
  const counts: Record<WitnessVerdict, number> = { pass: 0, fail: 0, unsupported: 0, error: 0 };
  for (const r of results) counts[r.verdict] += 1;
  return counts;
}

/**
 * Aggregate verdict for a clause badge (engine-ledger.md §3.1).
 *
 * Precedence: red (any fail) > amber (any error) > grey (anything unrun or
 * unsupported) > green (every witness ran and passed). `undefined` entries
 * are witnesses that exist for the clause but have not been run this session.
 * A clause with no witnesses at all is `none` — a visible coverage gap (§2.4).
 */
export function aggregateVerdict(
  results: readonly (WitnessResult | undefined)[],
): ClauseVerdict {
  if (results.length === 0) return "none";
  const present = results.filter((r): r is WitnessResult => r !== undefined);
  if (present.some((r) => r.verdict === "fail")) return "fail";
  if (present.some((r) => r.verdict === "error")) return "error";
  if (present.length < results.length) return "unrun";
  if (present.some((r) => r.verdict === "unsupported")) return "unsupported";
  return "pass";
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
