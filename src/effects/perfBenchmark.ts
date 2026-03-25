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
// These mirror real user patterns from uSEQ live-coding.
const BENCHMARK_EXPRESSIONS: Array<{ name: string; code: string }> = [
  // Simple phasors
  { name: "a1", code: "(define a1 (phasor 1))" },
  { name: "a2", code: "(define a2 (phasor 2))" },
  { name: "a3", code: "(define a3 (phasor 0.5))" },
  // Arithmetic on phasors
  { name: "a4", code: "(define a4 (* (phasor 1) (phasor 3)))" },
  { name: "a5", code: "(define a5 (+ (* 0.5 (phasor 1)) (* 0.5 (phasor 5))))" },
  // Conditionals
  { name: "a6", code: "(define a6 (if (> (phasor 1) 0.5) 1 0))" },
  // Digital outputs
  { name: "d1", code: "(define d1 (sqr 2))" },
  { name: "d2", code: "(define d2 (sqr 4))" },
  { name: "d3", code: "(define d3 (sqr 8))" },
  // Nested arithmetic (heavier eval load)
  { name: "a7", code: "(define a7 (* (+ (phasor 1) (phasor 2)) (phasor 0.25)))" },
  { name: "a8", code: "(define a8 (- 1 (* (phasor 3) (phasor 7))))" },
  { name: "a9", code: "(define a9 (+ (* 0.3 (phasor 1)) (* 0.3 (phasor 2)) (* 0.4 (phasor 4))))" },
  // Deeper nesting (worst case)
  { name: "a10", code: "(define a10 (* (+ (phasor 1) (* (phasor 2) (if (> (phasor 0.5) 0.5) 1 0.5))) 0.5))" },
  { name: "a11", code: "(define a11 (* (phasor 1) (+ 0.5 (* 0.5 (phasor 3)))))" },
  { name: "a12", code: "(define a12 (+ (* 0.25 (phasor 1)) (* 0.25 (phasor 2)) (* 0.25 (phasor 4)) (* 0.25 (phasor 8))))" },
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

  setTimeout(() => {
    perf.report();
    console.log(`[useq-bench] Profiling complete. Channels still active — call window.__useqBench.stop() to tear down.`);
  }, durationSeconds * 1000);
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
