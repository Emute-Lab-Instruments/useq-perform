/**
 * Witness substrate types — the shared shapes under the Engine Ledger and
 * (later) the Machine guide.
 *
 * Spec: `docs/specs/witnesses.md`.
 *
 * This module is foundation layer: it must not import from `src/runtime`,
 * `src/effects`, `src/ui`, `src/editors` or `src/transport`. The engine the
 * runner drives is injected (see `WitnessEngine`), so the runner stays
 * testable with a fake and the real WASM wiring lives in `src/runtime`.
 */

// ---------------------------------------------------------------------------
// Corpus shapes (harvested by scripts/harvest-witnesses.mjs)
// ---------------------------------------------------------------------------

/** A `spec:` citation split into file and optional clause (witnesses.md §1.3). */
export interface WitnessSpecRef {
  /** Spec filename relative to `src-useq/docs/specs/`, e.g. `time-warps.md`. */
  readonly file: string;
  /** Clause number, e.g. `3.1`. `null` when the citation names a whole file. */
  readonly clause: string | null;
}

/**
 * One step of a witness, exactly as it appears in the corpus YAML.
 *
 * The corpus step vocabulary is defined by the native runner
 * (`src-useq/scripts/run_conformance.py`): exactly one of `eval`, `tick`,
 * `sample`, `clear`, `health`, `config` is the operation; the remaining keys
 * are expectations attached to it.
 */
export interface WitnessStep {
  readonly eval?: string;
  readonly tick?: number;
  readonly sample?: { readonly output: string; readonly times: readonly number[] };
  readonly clear?: boolean;
  readonly health?: { readonly output: string; readonly expect: string };
  readonly config?: Record<string, unknown>;

  readonly expect_value?: number;
  readonly expect_values?: readonly number[];
  readonly expect_error?: boolean | "allow";
  readonly expect_diagnostic?: { readonly category: string; readonly span?: readonly number[] };
  readonly tol?: number;
  readonly comment?: string;
}

/** One conformance case (witnesses.md §1.2). */
export interface Witness {
  /** Unique name within the corpus. */
  readonly name: string;
  /** Primary spec file (first `spec:` reference), or `null` when absent. */
  readonly specFile: string | null;
  /** Primary clause (first `spec:` reference), or `null`. */
  readonly clause: string | null;
  /** All parsed `spec:` references. */
  readonly specRefs: readonly WitnessSpecRef[];
  readonly tags: readonly string[];
  /** Guide-block reference `<chapterId>/<blockId>` (witnesses.md §1.4). */
  readonly guide?: string;
  readonly steps: readonly WitnessStep[];
  /** Corpus path relative to the repo root. */
  readonly sourcePath: string;
}

/** Per-spec-file clause aggregation (witnesses.md §3.3). */
export interface WitnessSpecFileAggregate {
  /** Clause number -> witness names citing it. */
  readonly clauses: Readonly<Record<string, readonly string[]>>;
  /** Witness names citing the file with no clause. */
  readonly documentWitnesses: readonly string[];
}

/** The bundled `public/assets/witness-index.json` payload. */
export interface WitnessIndex {
  readonly version: number;
  readonly corpusDir: string;
  readonly fileCount: number;
  readonly witnessCount: number;
  readonly witnesses: readonly Witness[];
  readonly bySpecFile: Readonly<Record<string, WitnessSpecFileAggregate>>;
}

/** Schema version this build understands. */
export const SUPPORTED_WITNESS_INDEX_VERSION = 1;

// ---------------------------------------------------------------------------
// Run shapes
// ---------------------------------------------------------------------------

/**
 * Witness verdicts (witnesses.md §2.2).
 *
 * - `pass`        — every step ran and every expectation held
 * - `fail`        — an expectation did not hold: the engine and the spec disagree
 * - `unsupported` — the witness uses a step or expectation the in-app runner
 *                   cannot execute. Never reported as a pass.
 * - `error`       — runner/engine fault, distinct from an expectation mismatch
 */
export type WitnessVerdict = "pass" | "fail" | "unsupported" | "error";

/** Aggregate verdict for a clause badge (engine-ledger.md §3.1). */
export type ClauseVerdict = WitnessVerdict | "unrun" | "none";

/** Outcome of one step within a witness run. */
export interface WitnessStepResult {
  readonly index: number;
  /** The step operation, or `"unknown"` when the step has no recognised op. */
  readonly op: string;
  readonly verdict: WitnessVerdict;
  /** Human-readable explanation for a non-pass verdict. */
  readonly detail?: string;
  /** Values the engine produced, when the step sampled or evaluated. */
  readonly actual?: readonly number[];
  /** Values the corpus expected, when the step carried an expectation. */
  readonly expected?: readonly number[];
}

/** Outcome of one witness run. */
export interface WitnessResult {
  readonly name: string;
  readonly verdict: WitnessVerdict;
  /** First non-pass explanation, for badge tooltips and the detail view. */
  readonly detail?: string;
  readonly steps: readonly WitnessStepResult[];
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number;
}

/** Session-scoped map of witness name -> latest result (engine-ledger.md §3.3). */
export type WitnessResultMap = Readonly<Record<string, WitnessResult>>;

// ---------------------------------------------------------------------------
// Engine seam
// ---------------------------------------------------------------------------

/**
 * The engine capability the runner needs, injected by the caller.
 *
 * Isolation is the implementer's responsibility (witnesses.md §2.3): the
 * instance handed to the runner MUST NOT be the live session's engine.
 * `src/runtime/witnessEngine.ts` provides the real implementation over a
 * dedicated second instantiation of the WASM module.
 */
export interface WitnessEngine {
  /**
   * Discard all engine state so the next witness starts clean. The native
   * runner spawns a fresh probe process per case; this is its analogue.
   */
  reset(): Promise<void>;
  /** Evaluate a top-level form. Returns the raw `useq_eval` result string. */
  evaluate(code: string): string;
  /**
   * Read an output at an explicit time without advancing engine state
   * (witnesses.md §2.4). Returns `NaN` when the output is unassigned.
   */
  sampleOutput(output: string, time: number): number;
  /** Release the isolated engine instance. */
  dispose(): void;
}

/** Runner tuning knobs. */
export interface WitnessRunnerConfig {
  /**
   * Absolute tolerance for float comparison. Defaults to the native runner's
   * `DEFAULT_TOL` (`src-useq/scripts/run_conformance.py`).
   */
  readonly defaultTolerance?: number;
  /** Cooperative cancellation for long whole-corpus runs. */
  readonly signal?: { readonly aborted: boolean };
  /** Called after each witness completes, for incremental UI updates. */
  readonly onResult?: (result: WitnessResult) => void;
}
