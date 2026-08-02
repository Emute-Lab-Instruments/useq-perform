/**
 * Isolated WASM engine for the conformance-witness runner.
 *
 * Spec: `docs/specs/witnesses.md` §2.3 — running a witness must not mutate
 * the user's live session: no visible output changes, no cell definitions
 * leaking, no state-slot disturbance, no transport interaction.
 *
 * Implementation: a dedicated second instantiation of the WASM module
 * (`createIsolatedWasmModule()`), created lazily and **re-instantiated
 * between witnesses**. Re-instantiation rather than reset is forced by the
 * ABI — `useq_init()` is idempotent (`if (g_init_called) return;` in
 * `src-useq/wasm/wasm_wrapper.cpp`) and there is no `useq_clear` export, so
 * a fresh module is the only way to get a clean `SignalEngine`. The native
 * runner spawns a fresh probe process per case for the same reason.
 *
 * This module lives in `src/runtime` (not `src/lib`) because it depends on
 * runtime WASM wiring; the runner in `src/lib/witness` receives it through
 * the `WitnessEngine` interface.
 */

import type { WitnessEngine } from "../lib/witness/types.ts";
import { REQUIRED_WASM_EXPORTS } from "../contracts/wasmAbi.ts";
import { createIsolatedWasmModule, type EmscriptenModule } from "./wasmInterpreter.ts";

interface Bound {
  module: EmscriptenModule;
  evaluate: (code: string) => string;
  evalOutput: (name: string, time: number) => number;
}

function bind(module: EmscriptenModule): Bound {
  const call = <T>(desc: { symbol: string; returnType: string | null; argTypes: readonly string[] }): T =>
    module.cwrap(desc.symbol, desc.returnType, desc.argTypes as unknown as string[]) as T;

  const init = call<() => void>(REQUIRED_WASM_EXPORTS.useq_init);
  const evaluate = call<(code: string) => string>(REQUIRED_WASM_EXPORTS.useq_eval);
  const evalOutput = call<(name: string, t: number) => number>(REQUIRED_WASM_EXPORTS.useq_eval_output);

  init();
  return { module, evaluate, evalOutput };
}

/**
 * Create an isolated engine for witness runs.
 *
 * The engine starts with no instance; `reset()` creates the first one. The
 * runner calls `reset()` before every witness, so steps within one witness
 * share engine state (as the corpus requires) while witnesses never do.
 */
export function createWitnessEngine(): WitnessEngine {
  let bound: Bound | null = null;

  const require = (): Bound => {
    if (!bound) {
      throw new Error("Witness engine not initialised — call reset() before running a witness");
    }
    return bound;
  };

  return {
    async reset(): Promise<void> {
      // Dropping the reference is the whole teardown: an Emscripten module
      // owns its linear memory, so releasing it releases the engine.
      bound = null;
      bound = bind(await createIsolatedWasmModule());
    },

    evaluate(code: string): string {
      return String(require().evaluate(code) ?? "");
    },

    sampleOutput(output: string, time: number): number {
      // `useq_eval_output` saves and restores all mutable engine state, so
      // sampling is a pure read at an explicit time (witnesses.md §2.4) —
      // the same `commit=false` execution the native probe's `sample` uses.
      const value = require().evalOutput(output, Number(time) || 0);
      return typeof value === "number" ? value : NaN;
    },

    dispose(): void {
      bound = null;
    },
  };
}
