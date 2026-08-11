---
stability: stable
layer: cross-cutting
---

# Editor Runtime Contract

This document is the editor-facing contract for the firmware and WASM runtimes that `useq-perform` consumes.

For the higher-level product boundary and compatibility cuts, read [MAIN.md](MAIN.md) §4 first. This file is narrower: it defines what the editor may assume about hardware and WASM runtimes.

## Source files

- `src/contracts/useqRuntimeContract.ts` — shared transport commands, capability split constants, `assertEditorRuntimeContract()`
- `src/contracts/wasmAbi.ts` — WASM export signatures, `assertWasmAbi()`, `assertWasmAbiContract()`
- `src/contracts/runtimePorts.ts` — `RuntimePort` interface (hardware and WASM port shapes)
- `src/contracts/runtimeChannels.ts` — typed channels for runtime events
- `src/contracts/runtimeTypes.ts` — `RuntimeConnectionMode`, `TransportMode`, session types
- `src/contracts/useqProtocolSchema.ts` — generated-schema request/response validation and derived runtime support catalogs
- `src/runtime/runtimeCoordinator.ts` — canonical runtime state transitions and typed WASM-port selection
- `src/runtime/wasmRuntimeWorkerPort.ts` — sole production WASM `RuntimePort`
- `src/runtime/workers/wasmRuntime.worker.ts` — Worker-local WASM instantiation and ABI validation call site
- `src/runtime/witnessEngine.ts` — isolated, non-production conformance-witness interpreter
- `src/runtime/runtimeTransportService.ts` — fan-out of shared commands to both runtimes
- `src/effects/transportOrchestrator.ts` — transport command dispatch
- `src/contracts/wasmAbi.test.ts` — ABI contract tests
- `src/contracts/useqRuntimeContract.test.ts` — capability split tests
- `src/contracts/runtimeEvents.test.ts` — runtime event contract tests
- `src/runtime/wasmInterpreter.test.ts` — WASM bundle integration tests

## Canonical `src-useq` Source Of Truth

The authoritative firmware behavior for this repo is the `src-useq/` submodule checked into this repository, not any standalone local clone.

To inspect the exact pin in the current checkout, run:

```bash
npm run src-useq:status
```

That command reports the pinned gitlink commit, the checked-out submodule commit, the branch, and whether the submodule is dirty.

## Runtime Capability Split

(see `src/contracts/useqRuntimeContract.ts`, `src/contracts/runtimePorts.ts`)

The editor talks to two runtime shapes:

- Hardware runtime: full `uSEQ` over serial/JSON protocol.
- Browser runtime: `ModuLispInterpreter` compiled to WASM and hosted only in a dedicated Worker.

Shared capabilities are the only transport commands the editor may fan out to both runtimes:

- `(useq-play)`
- `(useq-pause)`
- `(useq-stop)`
- `(useq-rewind)`
- `(useq-clear)`
- `(useq-get-transport-state)`

Hardware-only capabilities:

- JSON `hello` handshake
- JSON `ping` heartbeat
- JSON `stream-config`
- USB serial input streams
- USB serial output streams

WASM-only capabilities:

- Direct time injection via `useq_update_time`
- Single-output sampling via `useq_eval_output`
- Batched output sampling via `useq_eval_outputs_time_window` / `useq_eval_outputs_time_window_into`

## WASM ABI Contract

(see `src/contracts/wasmAbi.ts`)

The canonical WASM ABI definition lives in `src/contracts/wasmAbi.ts`. This is the single source of truth for which symbols the editor expects from the Emscripten-generated WASM bundle.

### Required exports (stable ABI floor)

These symbols are listed in `src-useq/scripts/build_wasm.sh` under `-s EXPORTED_FUNCTIONS` and MUST be present in every conforming bundle:

| Symbol | cwrap return | cwrap args | Purpose |
|--------|-------------|------------|---------|
| `useq_init` | `null` | `[]` | Initialize the interpreter |
| `useq_eval` | `"string"` | `["string"]` | Evaluate ModuLisp code |
| `useq_update_time` | `null` | `["number"]` | Inject wall-clock time |
| `useq_eval_output` | `"number"` | `["string", "number"]` | Sample a named output at a time |

Heap helpers `_malloc` and `_free` are also required. The generated modularized JS wrapper must also expose a live `HEAPF64` view on the module object so the editor can read typed batch output buffers after `useq_eval_outputs_time_window_into()`.

### Runtime-probed batch exports

These helpers are defined in `wasm_wrapper.cpp` and the current build script exports them. The editor still probes them conservatively at instantiation because a stale generated bundle can omit the raw `_symbol` bindings even when source says they should exist:

| Symbol | cwrap return | cwrap args | Purpose |
|--------|-------------|------------|---------|
| `useq_eval_outputs_time_window` | `"string"` | `["string", "number", "number", "number"]` | Batch evaluate (JSON bridge) |
| `useq_eval_outputs_time_window_into` | `"number"` | `["string", "number", "number", "number", "number", "number"]` | Batch evaluate (typed buffer) |
| `useq_tick_and_project` | `"number"` | evolving; see [visualisation.md §7.2](visualisation.md) | Combined live tick + visualisation projection-fork operation |
| `useq_synth_artifacts` | `"string"` | `[]` | Read the versioned compiler patch/control snapshot |
| `useq_tick_synth_controls` | `"number"` | `["number", "number", "number"]` | Advance the live VM once and write controls in exact artefact-table order |
| `useq_last_error` | `"string"` | `[]` | Read last error message |
| `useq_last_diagnostics` | `"string"` | `[]` | Read diagnostics from the most recent eval |
| `useq_active_diagnostics` | `"string"` | `[]` | Read active output, named-state, and synth-control diagnostics |

Current expectation:

- `src-useq/scripts/build_wasm.sh` exports the batch helpers, `useq_last_error`, and the diagnostics helpers above
- `src-useq/wasm/useq.js` and `public/wasm/useq.js` should expose raw `_useq_*` bindings for them
- The editor probes anyway so a stale bundle degrades to per-sample evaluation instead of throwing repeatedly

The diagnostic payload shapes and clearing policy live in
`../../src-useq/docs/specs/diagnostics.md`; this document and
`../../src/contracts/wasmAbi.ts` own which editor-facing WASM exports are expected.

The experimental `useq_tick_and_project` export is intentionally specified by
the visualisation specs rather than frozen here while the projection-fork
contract is landing. The required semantic shape is: tick live state at
`tick_time`, then either reset-fill or extend a WASM-owned projection fork
without mutating live state. See
[visualisation.md](visualisation.md) and
`../../src-useq/docs/specs/visualisation-projection.md`.

When browser audio is running, `useq_tick_synth_controls` is the sole live
advancement operation. The Worker refuses `useq_tick_and_project` during that
ownership window; visualisation uses read-only time-window evaluation instead.
The generic runtime may probe the synth-control export, but an audio commit
fails preparation when it is absent or returns a count different from the
validated ABI-2 `controls` table.

### ABI validation

`assertWasmAbi()` from `src/contracts/wasmAbi.ts` is called immediately after `createModule()` resolves and BEFORE `useq_init()`. It throws a descriptive error if any required export is missing, catching ABI drift at instantiation time rather than at first use. (see `src/contracts/wasmAbi.ts` for assertion, `src/runtime/wasmInterpreter.ts` for call site)

## Contract Decision

WASM must continue to implement the shared transport builtins above. The editor may fan out only those shared builtins to both runtimes; it must not assume JSON protocol or serial stream parity in WASM.

The canonical editor constants live in:

- `../../src/contracts/useqRuntimeContract.ts` — shared transport commands and capability split
- `../../src/contracts/wasmAbi.ts` — WASM export signatures and ABI validation

Both `src/effects/transportOrchestrator.ts` and `src/runtime/wasmInterpreter.ts` import from these files instead of maintaining separate command lists or hard-coded symbol strings.

## Drift Prevention

(see `src/contracts/wasmAbi.test.ts`, `src/contracts/useqRuntimeContract.test.ts`, `src/contracts/runtimeEvents.test.ts`, `src/runtime/wasmInterpreter.test.ts`)

The following checks are the minimum guardrail against contract drift:

- `src/contracts/wasmAbi.test.ts` verifies ABI contract consistency, tests validation against mock modules, and ensures required/runtime-probed export sets are disjoint. The pinned compiler's tracked build profile and generated capability manifest are the executable export inventory.
- `src/contracts/generatedAssetPipeline.test.ts` verifies the compiler manifest names the exact clean gitlink and binds the exact built and served interpreter JS/WASM hashes and sizes. It also verifies compiler/application profile ownership, application source identity, and the served NodeDef clock contract without attributing NodeDef provenance to the compiler record.
- `src/runtime/wasmInterpreter.test.ts` instantiates the generated `public/wasm/useq.js` bundle and verifies the batch helper raw exports are actually present.
- `src/contracts/useqProtocolSchema.test.ts` verifies generated TypeScript/C++ freshness and every schema-owned valid/invalid fixture; `src/contracts/useqRuntimeContract.test.ts` verifies the shared command set and schema-derived hardware/WASM split.
- `src-useq/test/firmware/test_wire_protocol_contract.cpp` runs the generated request fixtures through the C++ validator and verifies unknown or reserved requests cannot fall through to eval.
- `assertWasmAbi()` throws at WASM instantiation time if the bundle does not export required symbols. (see `src/contracts/wasmAbi.ts`)
- `assertWasmAbiContract()` throws at module load time if the ABI contract constants are internally inconsistent. (see `src/contracts/wasmAbi.ts`)
- `assertEditorRuntimeContract()` throws during module load if the editor’s transport state mapping stops matching the shared command set. (see `src/contracts/useqRuntimeContract.ts`)

## Promotion Workflow

When firmware work starts in a standalone `uSEQ` clone:

1. Land and validate the firmware change in the standalone repo.
2. Promote it by advancing the `src-useq/` submodule in `useq-perform`.
3. Rebuild both generated WASM targets and copy their artefacts: `npm run build:wasm` (Emscripten/emcc; interpreter capability manifest plus the separate `osc/sine` NodeDef) followed by `npm run build:assets`. The copy step fails unless the clean pinned compiler commit and exact source/served interpreter bytes match the compiler record; the application record then binds its own source state, the compiler record, NodeDef descriptor/clock contract, and worklet. Target-build evidence remains a separate profile.
4. Cite the pinned `src-useq` commit in the `ergo` task, PR description, or release note for any editor change that depends on firmware behavior.
5. Audit the submodule state first during any cross-repo investigation; standalone repos are advisory until step 2 is complete.
