# Handoff: WASM Visualisation Performance Audit & Re-engineering

**Date**: 2026-03-25
**Branch**: `v1.2.0`
**Epic**: `useq-perform-xtd`
**Beads tracker**: `bd show useq-perform-xtd` for full issue graph

---

## Mission

Audit and re-engineer the WASM-driven visualization pipeline in uSEQ Perform to support **10-20 simultaneous visualization channels at 60fps** (main vis panel + inline probe oscilloscopes). This involves four major workstreams, all tracked under the epic.

## Architectural Decisions (confirmed with user)

1. **Bytecode VM** — Replace the tree-walking AST interpreter in the C++ ModuLisp interpreter with a bytecode compiler + VM. This is the #1 priority and biggest expected win (10-50x for tight arithmetic).
2. **WebGL renderer** — Replace Canvas 2D oscilloscope rendering with WebGL for GPU-accelerated line drawing.
3. **Web Worker threading** — Move WASM evaluation to a dedicated Web Worker so sampling never blocks the main thread.
4. **Profile first** — All work gates on establishing baselines (`useq-perform-egn`).

## Issue Graph

**NOTE**: Beads IDs were regenerated after a Dolt reset on 2026-03-25. Use `bd ready` for current state.

```
useq-wdf (EPIC) — WASM Vis Performance Audit & Re-engineering
│
├── useq-bz3 — Establish performance baselines (P1, READY — instrumentation done)
│   ├── useq-uif — Bytecode VM for ModuLisp interpreter (P1)
│   ├── useq-5kg — Batch inline probe sampling (P1, also depends on useq-j9s)
│   ├── useq-ano — Web Worker threading (P2)
│   └── useq-uq8 — WebGL renderer (P2)
│
├── useq-sdr — WASM build: -O3, LTO, SINGLE_FILE=0, wasm-opt (P1) ✓ CLOSED
├── useq-21c — Eliminate per-frame GC pressure (P1, quick win) ✓ CLOSED
│
└── useq-j9s — Validate probe widget perf in browser (P1, READY)
    └── blocks useq-5kg
```

Use `bd show <id>` for descriptions and `bd ready` to find unblocked work.

## Execution Strategy

**Phase 1 — Profile & Quick Wins** (do first, in parallel where possible):
- `useq-perform-egn`: Browser profiling baselines (3/8/15 channel scenarios)
- Then immediately: `useq-perform-t5x` (GC pressure) + `useq-perform-uc8` (WASM build flags) — these are quick wins
- `useq-perform-htw`: Validate probe widget behavior in browser

**Phase 2 — Core Architecture** (biggest ROI):
- `useq-perform-q3q`: Bytecode VM (major C++ work in src-useq submodule)
- `useq-perform-v10`: Batch probe sampling

**Phase 3 — Threading & Rendering** (after eval is fast):
- `useq-perform-nri`: Web Worker for WASM eval
- `useq-perform-cqw`: WebGL oscilloscope renderer

## Agent Delegation Strategy

The user wants you to use:
- **Opus 4.6 subagents** (via Agent tool) for TypeScript/JS work, profiling analysis, and code changes
- **Codex CLI with GPT 5.4** (via `/codex` skill or `codex` command) for C++ interpreter work in `src-useq/`
- **Worktrees** (`isolation: "worktree"` on Agent, or manual `git worktree`) for profiling instrumentation and experimental changes that shouldn't touch the main branch until validated
- **Parallel execution** wherever tasks are independent

## Codebase Architecture (what you need to know)

### The Hot Path (every frame at ~60fps)

```
localClock.tick() [rAF]                          ← src/effects/localClock.ts
  → visStore.updateTime(elapsed)                 ← src/utils/visualisationStore.ts
  → resampleExpressions(t) [async, fire-forget]  ← src/effects/visualisationSampler.ts
    → updateUseqWasmTime(t)                      ← src/runtime/wasmInterpreter.ts
    → refreshBarValue(t)                         ← evalOutputAtTime("bar", t)
    → rebuildAllExpressions()
      → evalOutputsInTimeWindow()                ← WASM batch call (typed or JSON fallback)
      → buildSampleSeries()                      ← creates TimeSample[] per channel (GC!)
      → updateExpressions()                      ← SolidJS store reconcile

serialVis.drawSerialVis() [separate rAF]         ← src/ui/visualisation/serialVis.ts
  → reads visStore.expressions
  → binary search for time window bounds
  → buildSegmentPoints() → new Point[] (GC!)
  → canvas lineTo() path tracing
```

### Key Files

| File | Role |
|------|------|
| `src/effects/localClock.ts` | Time source (rAF loop), `samplingInFlight` guard |
| `src/effects/visualisationSampler.ts` | Batch sampling coordinator, staleness guard, window cache |
| `src/utils/visualisationStore.ts` | SolidJS reactive store for vis state |
| `src/ui/visualisation/serialVis.ts` | Canvas 2D renderer (main vis panel) |
| `src/runtime/wasmInterpreter.ts` | JS↔WASM bridge, batch evaluator with typed/legacy/fallback chain |
| `src/editors/extensions/probes.ts` | Inline probe oscilloscopes (180ms throttle, 20 samples each) |
| `src/editors/extensions/probeHelpers.ts` | Probe expression building, temporal wrapper detection |
| `src/contracts/wasmAbi.ts` | WASM ABI contract (required + optional exports) |
| `src/contracts/visualisationChannels.ts` | Typed pub/sub channels |
| `src/contracts/runtimeChannels.ts` | Code evaluation event channel |

### WASM Interpreter (C++ in src-useq submodule)

| File | Role |
|------|------|
| `src-useq/wasm/wasm_wrapper.cpp` | WASM bindings (8 exported C functions) |
| `src-useq/wasm/emscripten-post.js` | Exposes HEAPF64 on Module |
| `src-useq/scripts/build_wasm.sh` | Emscripten build script (-O2, SINGLE_FILE=1) |
| `src-useq/uSEQ/src/modulisp/modulisp_interpreter.h` | Interpreter header (eval API, output storage) |
| `src-useq/uSEQ/src/modulisp/modulisp_interpreter_core.cpp` | Tree-walking eval_in(), apply() |
| `src-useq/uSEQ/src/modulisp/modulisp_api.cpp` | eval_output_internal(), eval_outputs() batch API |
| `src-useq/uSEQ/src/modulisp/lisp/value.h` | Value types (ATOM, INT, FLOAT, LIST, LAMBDA, BUILTIN...) |
| `src-useq/uSEQ/src/modulisp/lisp/parser.cpp` | Recursive descent parser |
| `src-useq/uSEQ/src/modulisp/lisp/environment.cpp` | Variable scoping |
| `src-useq/uSEQ/src/modulisp/temporal_context.h` | Pre-cached temporal variable lookup (beat, bar, t) |

### Interpreter Evaluation Model

The interpreter is a **pure tree-walking interpreter**. For each sample point:

1. `eval_output_internal()` looks up `StoredOutput.expr` (a Value AST node)
2. Calls `eval_at_time(expr, env, time_micros)` which sets temporal context and evaluates
3. `eval_in(Value, Environment)` recursively walks the AST:
   - Atoms → environment lookup (fast path for temporal vars via SymbolIntern)
   - Lists → evaluate head as function, evaluate args, apply
   - Lambdas → create new environment, evaluate body
   - Builtins → direct C++ function call

**No bytecode, no compilation, no memoization**. For 100 samples × 5 channels = 500 full tree-walks per frame.

### WASM Batch API

Three-tier fallback in `wasmInterpreter.ts`:

1. **Typed batch** (`useq_eval_outputs_time_window_into`): Writes Float64 results directly into pre-allocated WASM heap buffer. JS reads via `HEAPF64.subarray()`. Zero JSON overhead. Row-major: channels × samples.
2. **Legacy JSON batch** (`useq_eval_outputs_time_window`): Returns JSON string `{"a1": [0.5, 0.6, ...]}`. Parsed on JS side.
3. **Per-sample fallback**: Individual `useq_eval_output(name, t)` calls. N×M separate WASM calls.

Buffer management in `createBatchEvaluator()`: pre-allocated WASM heap via `_malloc`, reused across calls if capacity sufficient, `Float64Array.subarray` view for zero-copy reads.

### Inline Probes

- Throttled to 180ms (`PROBE_REFRESH_INTERVAL_MS`)
- 20 samples per probe (`PROBE_SAMPLE_COUNT`)
- Each sample wraps expression in `(offset N code)` and calls `evalInUseqWasmSilently()`
- **Not batched** — 20 individual WASM evals per probe per tick
- Only visible probes sampled (viewport intersection check)
- Canvas: 138×46 px, auto-scaling Y axis

### WASM Build Configuration

```bash
# Current flags (src-useq/scripts/build_wasm.sh) — updated 2026-03-25
emcc [sources] -O3 -flto -std=c++17 \
  -DWASM_BUILD -DUSE_OWN_ARDUINO_STR -DUSE_STD_IO -DNO_ETL \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 -s EXPORT_NAME='createModule' \
  -s SINGLE_FILE=0 -s ENVIRONMENT='web' \
  --post-js=wasm/emscripten-post.js --no-entry \
  -o wasm/useq.js
# Post-processing: wasm-opt -O3 --all-features useq.wasm
```

**Output**: 59KB JS glue + 540KB .wasm binary (streaming compilation, independent caching).

### Known Performance Bottlenecks

1. **Tree-walking interpreter**: 300-500+ AST walks per frame. No bytecode. (→ useq-uif)
2. ~~**Per-frame object allocation**~~: `buildSegmentPoints()` now uses pre-allocated Float64Array buffers. `rebuildAllExpressions` skips unchanged data. *Remaining*: `buildSampleSeries()` still creates `{time, value}` objects — Phase 2 of useq-21c.
3. **JSON overhead in batch path**: `JSON.stringify(outputsArray)` on JS side, `parse_output_names()` JSON parsing on C++ side, every batch call.
4. **Inline probes not batched**: 20 individual WASM evals per probe. With 10 probes = 200 evals at 5.6Hz. (→ useq-5kg)
5. ~~**WASM build not fully optimized**~~: Now -O3 with LTO and wasm-opt. SINGLE_FILE=0 enables streaming compilation. *Remaining*: SIMD evaluation pending profiling.
6. **Main thread blocking**: All WASM evaluation runs on main thread (async but not threaded). (→ useq-ano)
7. **Canvas 2D rendering**: No GPU acceleration, redraws everything per frame. (→ useq-uq8)

## Environment

- **Node**: v25.2.1, **npm**: 11.6.2
- **Emscripten**: 5.0.3 (`emcc` in PATH)
- **Codex CLI**: 0.116.0 (`codex` in PATH via bun)
- **Branch**: `v1.2.0` (main development branch)
- **src-useq submodule**: pinned at `df19e34` (Remove WASM eval logging)
- **Dev server**: `npm run dev` (uses portless, accessible at `https://useq-perform.localhost`)

## Build Commands

```bash
# Rebuild WASM interpreter
npm run build:wasm          # runs src-useq/scripts/build_wasm.sh

# Copy WASM + other assets to public/
npm run build:assets

# Full app build
npm run build

# Dev server
npm run dev

# Tests
npm run test:all            # mocha + vitest
npm run typecheck           # tsc --noEmit
npm run lint                # eslint with import boundary enforcement

# src-useq tests (C++ interpreter)
cd src-useq && ./scripts/test.sh
```

## Session Close Protocol

When finishing work:
1. `bd close <ids>` for completed issues
2. `git add <files> && git commit -m "..."` for code changes
3. `git push` (MANDATORY — work is not done until pushed)
4. `bd vc commit -m "session close"` for beads state
5. Update any in-progress issues with notes

## Notes

- The `src-useq/` submodule is a separate git repo. Changes there need separate commits and the submodule pointer updated in the parent repo.
- Use `bd remember "insight"` for persistent knowledge across sessions.
- The user prefers terse responses. Don't summarize diffs.
- Use worktrees for experimental/profiling work to keep v1.2.0 clean.
- The user is deeply technical — they understand the architecture. Don't over-explain.
