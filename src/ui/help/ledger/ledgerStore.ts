/**
 * Session-scoped Engine Ledger run state.
 *
 * Spec: `docs/specs/engine-ledger.md` §3.2–§3.3.
 *
 * Results are **not persisted** (§3.3) — a verdict is only meaningful for the
 * engine build currently loaded, so it dies with the session. Nothing here
 * touches the persistence service.
 *
 * Runs are on demand only (§3.2): no automatic background running on app
 * start. A run is interruptible, and the engine it drives is a dedicated
 * isolated instance that never touches the live session (§1.2, witnesses.md
 * §2.3).
 */

import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";

import { runWitnesses } from "../../../lib/witness/runner.ts";
import type { Witness, WitnessResult } from "../../../lib/witness/types.ts";
import { createWitnessEngine } from "../../../runtime/witnessEngine.ts";

export interface LedgerRunProgress {
  /** Witnesses completed so far in the current run. */
  readonly done: number;
  /** Total witnesses in the current run. */
  readonly total: number;
  /** Name of the witness most recently completed. */
  readonly current: string | null;
}

const [results, setResults] = createStore<Record<string, WitnessResult>>({});
const [running, setRunning] = createSignal(false);
const [progress, setProgress] = createSignal<LedgerRunProgress>({ done: 0, total: 0, current: null });
const [lastError, setLastError] = createSignal<string | null>(null);

let abortToken: { aborted: boolean } | null = null;

/** Reactive map of witness name -> latest result this session. */
export const ledgerResults = results;

/** True while a run is in flight. */
export const isLedgerRunning = running;

/** Progress of the run in flight. */
export const ledgerProgress = progress;

/** Message from the last run that could not start, or `null`. */
export const ledgerRunError = lastError;

/** Latest result for a witness, or `undefined` when it has not been run. */
export function resultFor(name: string): WitnessResult | undefined {
  return results[name];
}

/**
 * Run a batch of witnesses against a freshly created isolated engine.
 *
 * A new engine is created per run so a run never inherits state from an
 * earlier one, and it is disposed afterwards so the extra WASM instance does
 * not outlive the run.
 */
export async function runLedgerWitnesses(witnesses: readonly Witness[]): Promise<void> {
  if (running() || witnesses.length === 0) return;

  setRunning(true);
  setLastError(null);
  setProgress({ done: 0, total: witnesses.length, current: null });

  const token = { aborted: false };
  abortToken = token;
  const engine = createWitnessEngine();

  try {
    await runWitnesses(engine, witnesses, {
      signal: token,
      onResult: (result) => {
        setResults(produce((draft) => {
          draft[result.name] = result;
        }));
        setProgress((p) => ({ done: p.done + 1, total: p.total, current: result.name }));
      },
    });
  } catch (e) {
    setLastError(e instanceof Error ? e.message : String(e));
  } finally {
    engine.dispose();
    if (abortToken === token) abortToken = null;
    setRunning(false);
    setProgress((p) => ({ ...p, current: null }));
  }
}

/** Request cancellation of the run in flight (§3.2 — must be interruptible). */
export function cancelLedgerRun(): void {
  if (abortToken) abortToken.aborted = true;
}

/** Drop all session results. Test seam and a manual "clear" affordance. */
export function clearLedgerResults(): void {
  setResults(produce((draft) => {
    for (const key of Object.keys(draft)) delete draft[key];
  }));
  setProgress({ done: 0, total: 0, current: null });
  setLastError(null);
}
