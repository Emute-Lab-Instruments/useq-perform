# Editor Runtime Contract

This document is the editor-facing contract for the firmware and WASM runtimes that `useq-perform` consumes.

For the higher-level product boundary and compatibility cuts, read `docs/STABLE_CORE.md` first. This file is narrower: it defines what the editor may assume about hardware and WASM runtimes.

## Canonical `src-useq` Source Of Truth

The authoritative firmware behavior for this repo is the `src-useq/` submodule checked into this repository, not any standalone local clone.

To inspect the exact pin in the current checkout, run:

```bash
npm run src-useq:status
```

That command reports the pinned gitlink commit, the checked-out submodule commit, the branch, and whether the submodule is dirty.

## Runtime Capability Split

The editor talks to two runtime shapes:

- Hardware runtime: full `uSEQ` over serial/JSON protocol.
- Browser runtime: `ModuLispInterpreter` compiled to WASM.

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
- Optional batched output sampling when the generated bundle exports batch helpers

## WASM ABI Contract

The canonical WASM ABI definition lives in `src/contracts/wasmAbi.ts`. This is the single source of truth for which symbols the editor expects from the Emscripten-generated WASM bundle.

### Required exports (stable ABI floor)

These symbols are listed in `src-useq/scripts/build_wasm.sh` under `-s EXPORTED_FUNCTIONS` and MUST be present in every conforming bundle:

| Symbol | cwrap return | cwrap args | Purpose |
|--------|-------------|------------|---------|
| `useq_init` | `null` | `[]` | Initialize the interpreter |
| `useq_eval` | `"string"` | `["string"]` | Evaluate ModuLisp code |
| `useq_update_time` | `null` | `["number"]` | Inject wall-clock time |
| `useq_eval_output` | `"number"` | `["string", "number"]` | Sample a named output at a time |

Heap helpers `_malloc` and `_free` are also required (the latter is explicit in the build script; `_malloc` is implicitly available with `ALLOW_MEMORY_GROWTH`).

### Optional exports (probed at instantiation)

These are defined in `wasm_wrapper.cpp` but NOT in the build script export list. The editor probes for them via `tryCwrap` and degrades gracefully:

| Symbol | cwrap return | cwrap args | Purpose |
|--------|-------------|------------|---------|
| `useq_eval_outputs_time_window` | `"string"` | `["string", "number", "number", "number"]` | Batch evaluate (JSON bridge) |
| `useq_eval_outputs_time_window_into` | `"number"` | `["string", "number", "number", "number", "number", "number"]` | Batch evaluate (typed buffer) |
| `useq_last_error` | `"string"` | `[]` | Read last error message |

Treat batch sampling as a probed optimization, not part of the guaranteed stable core, until the build script explicitly adds these symbols to `EXPORTED_FUNCTIONS`.

### ABI validation

`assertWasmAbi()` from `src/contracts/wasmAbi.ts` is called immediately after `createModule()` resolves and BEFORE `useq_init()`. It throws a descriptive error if any required export is missing, catching ABI drift at instantiation time rather than at first use.

## Contract Decision

WASM must continue to implement the shared transport builtins above. The editor may fan out only those shared builtins to both runtimes; it must not assume JSON protocol or serial stream parity in WASM.

The canonical editor constants live in:

- `src/contracts/useqRuntimeContract.ts` — shared transport commands and capability split
- `src/contracts/wasmAbi.ts` — WASM export signatures and ABI validation

Both `src/effects/transport.ts` and `src/legacy/io/useqWasmInterpreter.ts` import from these files instead of maintaining separate command lists or hard-coded symbol strings.

## Drift Prevention

The following checks are the minimum guardrail against contract drift:

- `src/contracts/wasmAbi.test.ts` verifies the ABI contract constants match the build script export list, tests ABI validation against mock modules, and ensures required/optional export sets are disjoint.
- `src/contracts/useqRuntimeContract.test.ts` verifies the shared command set and the hardware-only/WASM-only split.
- `src-useq/test/hardware/test_json_protocol.cpp` verifies the `hello` I/O contract, `stream-config` output enablement/rate parsing, and that `hello`, `ping`, and `stream-config` parse without `code` while malformed eval requests still fail.
- `assertWasmAbi()` throws at WASM instantiation time if the bundle does not export required symbols.
- `assertWasmAbiContract()` throws at module load time if the ABI contract constants are internally inconsistent.
- `assertEditorRuntimeContract()` throws during module load if the editor’s transport state mapping stops matching the shared command set.

## Promotion Workflow

When firmware work starts in a standalone `uSEQ` clone:

1. Land and validate the firmware change in the standalone repo.
2. Promote it by advancing the `src-useq/` submodule in `useq-perform`.
3. Rebuild copied artifacts if the WASM bundle changed: `npm run build:wasm` and `npm run build:assets`.
4. Cite the pinned `src-useq` commit in the `bd` issue, PR description, or release note for any editor change that depends on firmware behavior.
5. Audit the submodule state first during any cross-repo investigation; standalone repos are advisory until step 2 is complete.
