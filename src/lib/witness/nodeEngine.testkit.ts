/**
 * Headless `WitnessEngine` over the real bundled WASM interpreter.
 *
 * Test-only. The browser path is `src/runtime/witnessEngine.ts`, which uses
 * the app's script loader and `createModule()`. This adapter loads the same
 * generated artefacts (`public/wasm/useq.js` + `useq.wasm`) from disk and
 * feeds the module an `instantiateWasm` hook, so witness verdicts can be
 * asserted against the shipped engine without a browser
 * (engine-ledger.md §5.2).
 *
 * Isolation works the same way as in the browser: `reset()` builds a new
 * module instance, so each witness gets a clean `SignalEngine`. The
 * `WebAssembly.Module` is compiled once and shared — compiled code is
 * immutable, and each instantiation gets its own linear memory.
 *
 * Not part of the app bundle: nothing under `src/` imports it outside tests.
 */

import fs from "node:fs";
import path from "node:path";
import type { WitnessEngine } from "./types.ts";

const DEFAULT_LOADER = path.join("public", "wasm", "useq.js");
const DEFAULT_BINARY = path.join("public", "wasm", "useq.wasm");

interface RawModule {
  cwrap(symbol: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<RawModule>;

export interface NodeWitnessEngineOptions {
  loaderPath?: string;
  binaryPath?: string;
}

/** True when the generated WASM artefacts are present on disk. */
export function wasmArtefactsAvailable(options: NodeWitnessEngineOptions = {}): boolean {
  return (
    fs.existsSync(options.loaderPath ?? DEFAULT_LOADER) &&
    fs.existsSync(options.binaryPath ?? DEFAULT_BINARY)
  );
}

/**
 * Build a `WitnessEngine` backed by the real WASM interpreter.
 * Resolves once the module is compiled; call `reset()` before each witness.
 */
export async function createNodeWitnessEngine(
  options: NodeWitnessEngineOptions = {},
): Promise<WitnessEngine> {
  const loaderPath = options.loaderPath ?? DEFAULT_LOADER;
  const binaryPath = options.binaryPath ?? DEFAULT_BINARY;

  const source = fs.readFileSync(loaderPath, "utf-8");
  // The generated loader is an IIFE assigning `createModule`; evaluate it in
  // a fresh function scope and hand back the factory.
  const factory = new Function(`${source}; return createModule;`)() as ModuleFactory;
  const compiled = await WebAssembly.compile(fs.readFileSync(binaryPath));

  let evaluate: ((code: string) => string) | null = null;
  let evalOutput: ((name: string, time: number) => number) | null = null;

  const instantiate = async (): Promise<void> => {
    const module = await factory({
      instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) {
        void WebAssembly.instantiate(compiled, imports).then(done);
        return {};
      },
    });
    (module.cwrap("useq_init", null, []) as () => void)();
    evaluate = module.cwrap("useq_eval", "string", ["string"]) as (code: string) => string;
    evalOutput = module.cwrap("useq_eval_output", "number", ["string", "number"]) as (
      name: string,
      time: number,
    ) => number;
  };

  return {
    async reset(): Promise<void> {
      evaluate = null;
      evalOutput = null;
      await instantiate();
    },
    evaluate(code: string): string {
      if (!evaluate) throw new Error("witness engine not initialised — call reset() first");
      return String(evaluate(code) ?? "");
    },
    sampleOutput(output: string, time: number): number {
      if (!evalOutput) throw new Error("witness engine not initialised — call reset() first");
      const value = evalOutput(output, Number(time) || 0);
      return typeof value === "number" ? value : NaN;
    },
    dispose(): void {
      evaluate = null;
      evalOutput = null;
    },
  };
}
