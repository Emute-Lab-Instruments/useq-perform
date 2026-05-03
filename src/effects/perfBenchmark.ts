/**
 * Performance Benchmark Scenarios
 *
 * Programmatically register visualisation channels for profiling.
 * Use from DevTools console: `window.__useqBench.run(8)`
 *
 * Scenarios:
 *   3  channels — baseline (typical use)
 *   8  channels — moderate load
 *   15 channels — stress test (target ceiling)
 */

import { registerVisualisation, unregisterVisualisation } from "./visualisationSampler.ts";
import { evalInUseqWasm } from "../runtime/wasmInterpreter.ts";
import { perf } from "../lib/perfTrace.ts";

// Expressions of varying complexity for realistic benchmarking.
// These mirror real user patterns from uSEQ live-coding — output
// assignments use the `(aN body)` / `(dN body)` form, not `define`.
//
// uSEQ has 8 analog (a1..a8) and 8 digital (d1..d8) outputs (spec
// outputs.md §1). Names outside that range are not valid output sinks
// and would silently sample as NaN.
const BENCHMARK_EXPRESSIONS: Array<{ name: string; code: string }> = [
  // Tier 1 — simple bar-phase passthroughs.
  { name: "a1", code: "(a1 bar)" },
  { name: "a2", code: "(a2 (slow 2 bar))" },
  { name: "a3", code: "(a3 (fast 4 bar))" },
  // Tier 2 — smooth shapers.
  { name: "a4", code: "(a4 (usin bar))" },
  { name: "a5", code: "(a5 (usin (fast 8 bar)))" },
  // Tier 3 — quantised + arithmetic.
  { name: "a6", code: "(a6 (from-list [0.1 0.4 0.2 0.7] bar))" },
  { name: "a7", code: "(a7 (* (usin bar) (usin (fast 3 bar))))" },
  { name: "a8", code: "(a8 (+ (* 0.1 (usin beat)) (* 0.2 (from-list [1 2 1 4] (slow 2 bar)))))" },
  // Digital outputs (Tier 1 onward beyond 8 channels).
  { name: "d1", code: "(d1 (sqr 2))" },
  { name: "d2", code: "(d2 (sqr 4))" },
  { name: "d3", code: "(d3 (sqr 8))" },
  { name: "d4", code: "(d4 (sqr 1))" },
  { name: "d5", code: "(d5 (sqr 16))" },
  { name: "d6", code: "(d6 (sqr 0.5))" },
  { name: "d7", code: "(d7 (sqr 0.25))" },
];

let activeChannels: string[] = [];

async function setup(channelCount: number): Promise<void> {
  // Tear down any existing benchmark channels
  await teardown();

  const count = Math.min(channelCount, BENCHMARK_EXPRESSIONS.length);
  const expressions = BENCHMARK_EXPRESSIONS.slice(0, count);

  console.log(`[useq-bench] Setting up ${count} channels...`);

  // Define all expressions in the interpreter first
  for (const expr of expressions) {
    await evalInUseqWasm(expr.code);
  }

  // Register all for visualisation
  for (const expr of expressions) {
    await registerVisualisation(expr.name, expr.code);
    activeChannels.push(expr.name);
  }

  console.log(`[useq-bench] ${count} channels active. Enable perf tracing with window.__useqPerf.enable()`);
}

async function teardown(): Promise<void> {
  for (const name of activeChannels) {
    unregisterVisualisation(name);
  }
  activeChannels = [];
}

async function run(channelCount: number = 3, durationSeconds: number = 10): Promise<void> {
  await setup(channelCount);

  perf.reset();
  perf.enable();

  console.log(`[useq-bench] Profiling ${channelCount} channels for ${durationSeconds}s...`);
  console.log(`[useq-bench] Open DevTools Performance panel and record during this window.`);

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      perf.report();
      console.log(`[useq-bench] Profiling complete. Channels still active — call window.__useqBench.stop() to tear down.`);
      resolve();
    }, durationSeconds * 1000);
  });
}

async function stop(): Promise<void> {
  perf.disable();
  perf.report();
  await teardown();
  console.log("[useq-bench] Benchmark stopped and channels removed.");
}

// Expose on window for DevTools access
if (typeof window !== "undefined") {
  (window as any).__useqBench = { setup, teardown, run, stop };
}

export { setup, teardown, run, stop };
