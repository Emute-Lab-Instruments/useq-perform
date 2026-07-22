/**
 * WASM-backed resource-safety regression tests.
 *
 * These exercise the *real* rebuilt interpreter in `public/wasm/useq.{js,wasm}`
 * (not a mock), driving it through `useq_eval` / `useq_update_time` /
 * `useq_eval_output` / `useq_eval_outputs_time_window_into` exactly as the
 * runtime bridge in `src/runtime/wasmInterpreter.ts` does. They target the
 * classes of bug Dimi flagged in the firmware C++ fix:
 *
 *   - FW1/FW3 crash / OOB safety: pathological programs (very deep nesting,
 *     dense / wide DAGs) must NOT trap the wasm. The module must either
 *     evaluate or return a clean diagnostic string, and a subsequent normal
 *     eval must still work (the module is not left wedged).
 *   - FW4 prev() feedback in batch mode: an output using prev() as feedback
 *     with no explicit defstate must follow previous-sample semantics
 *     (prev.md §1.4/§1.5/§1.6), not get stuck at zero.
 *   - RP2040 code-size regression: a byte-size ceiling on useq.wasm so an
 *     accidental code-size blowup is caught in CI.
 *
 * Build provenance note: if `npm run build:wasm` / `build:assets` did not run,
 * public/wasm/* may be stale and these assertions describe the *shipped*
 * bundle, which is exactly what we want to guard.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

const WASM_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/wasm/useq.js",
);
const WASM_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/wasm/useq.wasm",
);

/**
 * Code-size ceiling for the RP2040 build. Current shipped size is ~304 KB
 * (303930 bytes as of the 2026-06-14 firmware fix rebuild). The ceiling is set
 * a bit above that. Growing past it is not automatically a bug, but it MUST be
 * reviewed: the firmware shares this interpreter and RP2040 flash is finite, so
 * a sudden jump usually signals accidental code-size blowup (template bloat,
 * an un-stripped symbol set, -O level regression, a giant table, etc.).
 * If you intentionally grow it, bump this number and say why in the commit.
 */
const WASM_SIZE_CEILING_BYTES = 360 * 1024;

type WasmModule = {
  cwrap: (sym: string, ret: string | null, args: string[]) => (...a: any[]) => any;
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  HEAPF64: Float64Array;
} & Record<string, unknown>;

/**
 * Load the shipped Emscripten bundle in a Node vm context and instantiate the
 * real wasm module, mirroring loadGeneratedBundleModule() in
 * wasmInterpreter.test.ts. Returns the live Module with cwrap + HEAPF64.
 */
async function loadRealWasm(): Promise<WasmModule> {
  const code = readFileSync(WASM_JS, "utf8");
  const context: Record<string, unknown> = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    fetch,
    performance,
    WebAssembly,
    globalThis: {},
    document: { currentScript: { src: "http://localhost/useq.js" } },
    exports: {},
    module: { exports: {} },
    define: undefined,
  });
  (context as { globalThis: unknown }).globalThis = context;
  vm.runInContext(code, context, { filename: "useq.js" });
  const createModule = ((context.module as { exports?: unknown }).exports ||
    (context as { createModule?: unknown }).createModule) as
    | ((opts?: Record<string, unknown>) => Promise<WasmModule>)
    | undefined;
  if (typeof createModule !== "function") {
    throw new Error(`Generated WASM bundle did not expose createModule(): ${WASM_JS}`);
  }
  const dir = path.dirname(WASM_JS);
  const wasmBytes = new Uint8Array(readFileSync(WASM_BIN));
  return createModule({
    // The generated bundle does not accept `wasmBinary` through its incoming
    // Module API. Instantiate explicitly so Node never attempts fetch() on a
    // filesystem path.
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance) => void,
    ) => {
      void WebAssembly.instantiate(wasmBytes, imports).then(({ instance }) =>
        receiveInstance(instance),
      );
      return {};
    },
    locateFile: (f: string) => path.resolve(dir, f),
  });
}

type Bridge = {
  module: WasmModule;
  init: () => void;
  evalCode: (code: string) => string;
  updateTime: (t: number) => void;
  evalOutput: (name: string, t: number) => number;
  /** Returns the per-sample values for a single output over [start,end]. */
  batchInto: (output: string, start: number, end: number, n: number) => number[];
  lastError: () => string;
};

function makeBridge(module: WasmModule): Bridge {
  const init = module.cwrap("useq_init", null, []) as () => void;
  const evalCode = module.cwrap("useq_eval", "string", ["string"]) as (c: string) => string;
  const updateTime = module.cwrap("useq_update_time", null, ["number"]) as (t: number) => void;
  const evalOutput = module.cwrap("useq_eval_output", "number", ["string", "number"]) as (
    name: string,
    t: number,
  ) => number;
  const typedEval = module.cwrap(
    "useq_eval_outputs_time_window_into",
    "number",
    ["string", "number", "number", "number", "number", "number"],
  ) as (
    outputsJson: string,
    start: number,
    end: number,
    sampleCount: number,
    pointer: number,
    totalEntries: number,
  ) => number;
  const lastError = module.cwrap("useq_last_error", "string", []) as () => string;

  const batchInto = (output: string, start: number, end: number, n: number): number[] => {
    const pointer = module._malloc(n * Float64Array.BYTES_PER_ELEMENT);
    const base = pointer / Float64Array.BYTES_PER_ELEMENT;
    try {
      const status = typedEval(JSON.stringify([output]), start, end, n, pointer, n);
      if (status < 1) {
        throw new Error(`typed batch eval failed (status ${status}): ${lastError()}`);
      }
      const view = module.HEAPF64.subarray(base, base + n);
      return Array.from(view);
    } finally {
      module._free(pointer);
    }
  };

  return { module, init, evalCode, updateTime, evalOutput, batchInto, lastError };
}

describe("wasm resource safety (real rebuilt interpreter)", () => {
  let bridge: Bridge;

  beforeAll(async () => {
    const module = await loadRealWasm();
    bridge = makeBridge(module);
    bridge.init();
  });

  describe("FW1/FW3 — crash / OOB safety under graph stress", () => {
    it("evaluates a deep-but-bounded nested arithmetic graph without trapping", () => {
      // 50 levels of nesting compiles and executes a real graph (above the
      // parser's token guard this turns into a clean diagnostic instead).
      let nested = "1";
      for (let i = 0; i < 50; i++) nested = `(+ ${nested} 1)`;
      const result = bridge.evalCode(`(a1 ${nested})`);
      expect(result).toBe("ok");
      expect(bridge.evalOutput("a1", 0)).toBe(51);
    });

    it("returns a clean diagnostic (not a trap) for pathologically deep nesting, and stays usable", () => {
      let nested = "1";
      for (let i = 0; i < 4000; i++) nested = `(+ ${nested} 1)`;

      // The wasm must not crash/trap here. It either evaluates or returns a
      // string diagnostic. Crucially: calling it must not throw / abort.
      let result = "";
      expect(() => {
        result = bridge.evalCode(`(a1 ${nested})`);
      }).not.toThrow();
      expect(typeof result).toBe("string");
      // Current interpreter guards this at parse time with a clean message.
      expect(result.toLowerCase()).toMatch(/error|too large|limit/);

      // The module must not be wedged: a normal eval still works.
      expect(bridge.evalCode("(a2 0.5)")).toBe("ok");
      expect(bridge.evalOutput("a2", 0)).toBe(0.5);
    });

    it("evaluates a dense/wide multi-output DAG (all analog + digital outs) without trapping", () => {
      let program = "(do ";
      for (let i = 1; i <= 8; i++) program += `(a${i} (* ${i} 0.1)) `;
      for (let i = 1; i <= 8; i++) program += `(d${i} (% ${i} 2)) `;
      program += ")";

      let result = "";
      expect(() => {
        result = bridge.evalCode(program);
      }).not.toThrow();
      expect(result).toBe("ok");

      // Spot-check a few outputs across the wide DAG.
      expect(bridge.evalOutput("a3", 0)).toBeCloseTo(0.3, 10);
      expect(bridge.evalOutput("a8", 0)).toBeCloseTo(0.8, 10);
      expect(bridge.evalOutput("d1", 0)).toBe(1);
      expect(bridge.evalOutput("d2", 0)).toBe(0);

      // Still usable afterwards.
      expect(bridge.evalCode("(a1 0.25)")).toBe("ok");
      expect(bridge.evalOutput("a1", 0)).toBe(0.25);
    });

    it("survives an alternating storm of oversized and valid programs (no accumulated wedge)", () => {
      let huge = "1";
      for (let i = 0; i < 2000; i++) huge = `(* ${huge} 2)`;

      for (let round = 0; round < 5; round++) {
        // Oversized program: must return cleanly, never trap.
        expect(() => bridge.evalCode(`(a1 ${huge})`)).not.toThrow();
        // Valid program right after: must keep working every round.
        expect(bridge.evalCode(`(a1 ${0.1 * round})`)).toBe("ok");
        expect(bridge.evalOutput("a1", 0)).toBeCloseTo(0.1 * round, 10);
      }
    });
  });

  describe("FW4 — prev() feedback in batch mode (prev.md §1.4/§1.5/§1.6)", () => {
    it("integrates a self-referential prev() feedback output across a batch window", () => {
      // (a2 (+ (prev a2) 0.01)) integrates by 0.01 per sample (prev.md §1.6).
      // No explicit defstate: the 'state' lives in the engine's per-output
      // prev buffer (prev.md §1.7).
      expect(bridge.evalCode("(a2 (+ (prev a2) 0.01))")).toBe("ok");

      const n = 6;
      const samples = bridge.batchInto("a2", 0, 0.05, n);

      // §1.5: first sample reads neutral default (0) for prev a2 -> 0.01.
      // §1.6: each subsequent sample is the previous + 0.01.
      expect(samples).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(samples[i]).toBeCloseTo(0.01 * (i + 1), 9);
      }
      // Concretely: not stuck at zero, not stuck at a constant.
      expect(samples[0]).toBeCloseTo(0.01, 9);
      expect(samples[5]).toBeCloseTo(0.06, 9);
      expect(bridge.lastError()).toBe("");
    });

    it("reads the immediately-preceding sample within the batch for prev()", () => {
      // (a3 (prev a3)) holds whatever it last produced; seed it then read.
      // A simpler observable: a counter that doubles each sample is too fast,
      // so use a fixed-step accumulator and assert monotonic strictly-increasing
      // by exactly the step — the hallmark of correct within-batch prev.
      expect(bridge.evalCode("(a3 (+ (prev a3) 0.25))")).toBe("ok");
      const samples = bridge.batchInto("a3", 0, 1, 5);
      expect(samples).toEqual([0.25, 0.5, 0.75, 1.0, 1.25]);
    });
  });

  describe("RP2040 code-size / per-tick regression guards", () => {
    it("keeps useq.wasm under the code-size ceiling", () => {
      const size = statSync(WASM_BIN).size;
      expect(
        size,
        `useq.wasm grew to ${size} bytes (> ${WASM_SIZE_CEILING_BYTES} ceiling). ` +
          `RP2040 flash is shared with this interpreter; investigate before raising the ceiling.`,
      ).toBeLessThanOrEqual(WASM_SIZE_CEILING_BYTES);
    });

    it("evaluates and batch-samples a moderately complex program within a generous wall-clock bound", () => {
      // Coarse per-tick-cost smoke. Generous bound: we are guarding against a
      // catastrophic blowup (e.g. O(n^2) compile or runaway allocation), not
      // micro-benchmarking.
      expect(bridge.evalCode("(a1 (* 0.5 (+ (prev a1) (% (* t 4) 2))))")).toBe("ok");

      const start = performance.now();
      const samples = bridge.batchInto("a1", 0, 4, 256);
      const elapsedMs = performance.now() - start;

      expect(samples).toHaveLength(256);
      expect(samples.every((v) => Number.isFinite(v))).toBe(true);
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});
