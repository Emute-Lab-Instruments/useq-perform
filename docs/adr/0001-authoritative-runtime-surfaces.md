# ADR 0001: Authoritative Runtime Surfaces

- Status: Accepted
- Date: 2026-03-13

## Context

The repository still contains a mix of current runtime owners, retained legacy adapters, heartbeat audit artifacts, and older migration-era modules. Future work keeps drifting when contributors treat all of those surfaces as equally authoritative.

## Decision

The canonical surfaces for ongoing work are:

- Product boundary: `docs/specs/MAIN.md` §4
- Editor-facing runtime contract: `docs/specs/runtime-contract.md`
- Serial protocol details: `src-useq/docs/specs/wire-protocol.md`
- Production startup path: `src/main.ts`, `src/runtime/bootstrap.ts`
- Startup and runtime ownership: `src/runtime/bootstrap.ts` (also covers startup-mode selection, formerly `bootstrapPlan.ts`), `src/runtime/runtimeService.ts` plus the split services (`runtimeSettingsService.ts`, `runtimeTransportService.ts`, `runtimeSessionService.ts`), `src/runtime/runtimeSession.ts`, `src/runtime/runtimeDiagnostics.ts`
- Runtime contract definitions: `src/runtime/jsonProtocol.ts` (in-runtime helpers), `src/transport/json-protocol.ts` (wire driver), `src/contracts/useqRuntimeContract.ts`, `src/contracts/runtimeChannels.ts`, `src/contracts/runtimeTypes.ts`
- Settings ownership: `src/lib/settings/` (schema, normalization, persistence; `src/lib/appSettings.ts` is now a thin re-export shim), `src/runtime/appSettingsRepository.ts` (runtime state, subscription, bootstrap orchestration), `src/runtime/startupContext.ts` (startup flag parsing — incorporates former `urlParams.ts`)
- Firmware and WASM source of truth: the pinned `src-useq/` submodule reported by `npm run src-useq:status`

## Consequences

- New repo guidance should link to `MAP.md` (terse index) and this ADR pack instead of re-explaining architecture ad hoc.
- Cleanup work should consolidate ownership toward the canonical files above instead of promoting additional legacy globals or duplicate stores.
- Audit artifacts under `history/` can inform work, but they do not override the canonical sources listed here.
