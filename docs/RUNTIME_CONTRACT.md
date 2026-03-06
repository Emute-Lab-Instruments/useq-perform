# Editor Runtime Contract

This document is the editor-facing contract for the firmware and WASM runtimes that `useq-perform` consumes.

## Canonical `src-useq` Source Of Truth

The authoritative firmware behavior for this repo is the `src-useq/` submodule checked into this repository, not any standalone local clone.

As of 2026-03-06, the superproject `HEAD` pins:

- Repo: `git@github.com:Emute-Lab-Instruments/uSEQ.git`
- Path: `src-useq/`
- Branch currently checked out in the submodule: `feat/json-protocol-transport`
- Authoritative pinned commit: `7ccae70291d065a939b067d8e416aac0fafe48b6`

To cite the exact firmware commit that editor work depends on, run:

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
- Batched output sampling via `useq_eval_outputs_time_window` and `useq_eval_outputs_time_window_into`

## Contract Decision

WASM must continue to implement the shared transport builtins above. The editor may fan out only those shared builtins to both runtimes; it must not assume JSON protocol or serial stream parity in WASM.

The canonical editor constants live in `src/contracts/useqRuntimeContract.ts`, and both `src/effects/transport.ts` and `src/legacy/io/useqWasmInterpreter.ts` import from that file instead of maintaining separate command lists.

## Drift Prevention

The following checks are the minimum guardrail against contract drift:

- `src/contracts/useqRuntimeContract.test.ts` verifies the shared command set and the hardware-only/WASM-only split.
- `src-useq/test/hardware/test_json_protocol.cpp` verifies that `hello`, `ping`, and `stream-config` parse without `code`, while malformed eval requests still fail.
- `assertEditorRuntimeContract()` throws during module load if the editor’s transport state mapping stops matching the shared command set.

## Promotion Workflow

When firmware work starts in a standalone `uSEQ` clone:

1. Land and validate the firmware change in the standalone repo.
2. Promote it by advancing the `src-useq/` submodule in `useq-perform`.
3. Rebuild copied artifacts if the WASM bundle changed: `npm run build:wasm` and `npm run build:assets`.
4. Cite the pinned `src-useq` commit in the `bd` issue, PR description, or release note for any editor change that depends on firmware behavior.
5. Audit the submodule state first during any cross-repo investigation; standalone repos are advisory until step 2 is complete.
