# ADR 0001: Authoritative Runtime Surfaces

- Status: Accepted
- Date: 2026-03-13

## Context

The repository still contains a mix of current runtime owners, retained legacy adapters, heartbeat audit artifacts, and older migration-era modules. Future work keeps drifting when contributors treat all of those surfaces as equally authoritative.

## Decision

The canonical surfaces for ongoing work are:

- Product boundary: `docs/STABLE_CORE.md`
- Editor-facing runtime contract: `docs/RUNTIME_CONTRACT.md`
- Serial protocol details: `docs/PROTOCOL.md`
- Production startup path: `src/legacy/main.ts`, `src/legacy/app/application.ts`, `src/legacy/ui/ui.ts`
- Startup and runtime ownership: `src/runtime/bootstrapPlan.ts`, `src/runtime/runtimeService.ts`, `src/runtime/runtimeSession.ts`, `src/runtime/runtimeDiagnostics.ts`
- Runtime contract definitions: `src/runtime/jsonProtocol.ts`, `src/contracts/useqRuntimeContract.ts`, `src/contracts/runtimeEvents.ts`
- Settings ownership: `src/legacy/config/appSettings.ts`, `src/legacy/config/configLoader.ts`, `src/legacy/urlParams.ts`
- Firmware and WASM source of truth: the pinned `src-useq/` submodule reported by `npm run src-useq:status`

Transitional adapters remain real runtime code, but they are not canonical owners:

- `src/runtime/legacyRuntimeAdapter.ts`
- `src/utils/settingsStore.ts`
- `src/legacy/io/serialComms.ts`
- `src/legacy/io/useqWasmInterpreter.ts`
- `src/legacy/ui/serialVis/visualisationController.ts`

## Consequences

- New repo guidance should link to `docs/REPO_MAP.md` and this ADR pack instead of re-explaining architecture ad hoc.
- Cleanup work should consolidate ownership toward the canonical files above instead of promoting additional legacy globals or duplicate stores.
- Audit artifacts under `history/` can inform work, but they do not override the canonical sources listed here.
