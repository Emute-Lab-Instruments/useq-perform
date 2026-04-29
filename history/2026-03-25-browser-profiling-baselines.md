## Browser Profiling Baselines

Date: 2026-03-25

Issue: `useq-bz3`

### Scope

Establish baseline browser-local WASM visualisation costs before the remaining
performance workstreams land. These numbers are intended to unblock:

- `useq-uif.8` bytecode VM validation vs baseline
- `useq-5kg` batched inline probe sampling
- `useq-ano` worker offload
- `useq-uq8` WebGL renderer comparison

### Environment

- Repo checkout: `/home/w1n5t0n/src/useq-perform`
- Frontend host: `http://127.0.0.1:5000/`
- Browser: `Chrome 143.0.0.0` on Linux x86_64
- Runtime mode: browser-local WASM
- Profiling hooks: `window.__useqPerf`, `window.__useqBench`
- Graph panel: visible during all measurements

### Method

1. Open the app in Chromium and activate the graph panel.
2. Warm the runtime once with `window.__useqBench.setup(1)`.
3. For each scenario (`3`, `8`, `15` channels):
   - call `window.__useqBench.setup(N)`
   - reset and enable `window.__useqPerf`
   - collect perf measures for 5 seconds
   - disable tracing and aggregate `performance.measure(...)` entries
   - call `window.__useqBench.stop()`

The benchmark expressions come from `src/effects/perfBenchmark.ts` and cover
simple phasors, arithmetic combinations, conditionals, and deeper nesting.

### Results

#### 3 channels

| label | count | avg ms | max ms | total ms |
|---|---:|---:|---:|---:|
| `build-sample-series` | 166 | 0.028 | 0.300 | 4.6 |
| `frame-tick` | 466 | 0.518 | 1.600 | 241.3 |
| `rebuild-all` | 166 | 1.173 | 2.900 | 194.8 |
| `refresh-bar` | 466 | 0.026 | 0.200 | 12.1 |
| `render-frame` | 233 | 0.579 | 1.400 | 135.0 |
| `resample-total` | 466 | 0.778 | 4.200 | 362.6 |
| `wasm-typed-batch` | 166 | 0.120 | 0.300 | 19.9 |
| `wasm-update-time` | 466 | 0.047 | 0.200 | 22.0 |

#### 8 channels

| label | count | avg ms | max ms | total ms |
|---|---:|---:|---:|---:|
| `build-sample-series` | 165 | 0.030 | 0.200 | 4.9 |
| `frame-tick` | 601 | 0.538 | 2.000 | 323.3 |
| `rebuild-all` | 165 | 2.151 | 4.400 | 354.9 |
| `refresh-bar` | 601 | 0.022 | 0.200 | 13.3 |
| `render-frame` | 301 | 0.981 | 2.600 | 295.3 |
| `resample-total` | 601 | 0.982 | 5.400 | 590.2 |
| `wasm-typed-batch` | 165 | 0.255 | 0.900 | 42.1 |
| `wasm-update-time` | 601 | 0.038 | 0.300 | 22.8 |

#### 15 channels

| label | count | avg ms | max ms | total ms |
|---|---:|---:|---:|---:|
| `build-sample-series` | 162 | 0.054 | 0.200 | 8.8 |
| `frame-tick` | 564 | 0.601 | 1.700 | 338.9 |
| `rebuild-all` | 162 | 4.727 | 9.400 | 765.8 |
| `refresh-bar` | 564 | 0.026 | 0.200 | 14.5 |
| `render-frame` | 282 | 2.292 | 5.700 | 646.4 |
| `resample-total` | 564 | 1.821 | 11.100 | 1027.3 |
| `wasm-typed-batch` | 162 | 0.438 | 0.900 | 71.0 |
| `wasm-update-time` | 564 | 0.046 | 0.200 | 26.1 |

### Findings

- The typed batch WASM path is active in the measured build.
- `rebuild-all` scales sharply with channel count and is the dominant sampling
  cost by 15 channels.
- `render-frame` remains cheaper than sampling at low channel counts, but at
  15 channels it grows to a second major contributor and becomes worth attacking
  with the planned WebGL renderer.
- `build-sample-series` remains a small but non-zero cost compared with the
  WASM batch execution itself.
- These numbers establish a concrete browser-local baseline for the later
  bytecode VM speedup comparison in `useq-uif.8`.
