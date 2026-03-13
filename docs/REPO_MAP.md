# Repo Map

This is the current "read this first" map for `useq-perform`. Use it to find the authoritative runtime, settings, protocol, and tooling surfaces before acting on older docs, audit artifacts, or retained legacy modules.

## Read Order

1. `README.md` for build, test, and high-level repo layout.
2. `docs/STABLE_CORE.md` for the product boundary and compatibility cuts.
3. `docs/RUNTIME_CONTRACT.md` for the editor-facing hardware versus WASM contract.
4. `docs/PROTOCOL.md` for serial framing and JSON request or response shapes.
5. `docs/adr/` for the current architectural decisions that future cleanup work should preserve.

## Production Entry Path

- `src/legacy/main.ts`
  Current production entrypoint. Reads startup flags, loads config, and starts the app.
- `src/legacy/app/application.ts`
  Startup orchestration and environment setup.
- `src/legacy/ui/ui.ts`
  Mounts the retained DOM shell and the Solid adapter surfaces.

## Canonical Runtime And Startup Owners

- `src/runtime/bootstrapPlan.ts`
  Startup mode selection and capability-aware bootstrap decisions.
- `src/runtime/runtimeService.ts`
  Runtime command fan-out, session sync, and runtime lifecycle coordination.
- `src/runtime/runtimeSession.ts`
  Hardware-versus-browser-local precedence and the shared runtime snapshot rules.
- `src/runtime/runtimeDiagnostics.ts`
  Canonical startup and environment diagnostics surface.
- `src/runtime/jsonProtocol.ts`
  Typed JSON protocol floor for hardware communication.
- `src/contracts/useqRuntimeContract.ts`
  Shared hardware and WASM transport contract constants.
- `src/contracts/runtimeEvents.ts`
  Typed runtime event names and payload helpers.

## Canonical Settings And Bootstrap Files

- `src/legacy/config/appSettings.ts`
  Canonical settings schema, defaults, persistence merge rules, and config document conversion.
- `src/legacy/config/configLoader.ts`
  Bootstrap precedence for committed config, local persistence, and URL overrides.
- `src/legacy/urlParams.ts`
  Typed startup flag parsing. Do not reintroduce ad hoc URL global reads elsewhere.
- `src/utils/settingsStore.ts`
  Transitional UI-facing adapter over settings state. Treat it as a bridge, not the canonical owner.

## Platform Adapters And High-Risk Legacy Seams

- `src/legacy/io/serialComms.ts`
  Retained Web Serial transport adapter and protocol negotiation seam.
- `src/legacy/io/useqWasmInterpreter.ts`
  Retained WASM adapter and export-probing seam.
- `src/runtime/legacyRuntimeAdapter.ts`
  Containment layer between the modern runtime service and legacy runtime modules.
- `src/legacy/ui/serialVis/visualisationController.ts`
  Retained visualisation controller with substantial legacy coupling.

## UI Surfaces

- `src/ui/TransportToolbar.tsx`
  Primary runtime control UI.
- `src/ui/MainToolbar.tsx`
  Top-level editor and panel control surface.
- `src/ui/adapters/toolbars.tsx`
  Imperative mount bridge for toolbar components.
- `src/ui/adapters/panels.tsx`
  Imperative mount bridge for settings and help panels.
- `src/ui/settings/`
  Live settings panel components. Treat `ConfigurationManagement.tsx` as internal dev tooling only.

## Dev-Only Or Internal Tooling

- `src/legacy/config/configManager.ts`
  Internal dev tooling for exporting or importing config files and optionally writing to the repo via the config server. This is not part of the stable public UI surface.
- `src/legacy/config/configManager.ts` plus `scripts/config-server.mjs`
  Source-file persistence path used for local development workflows only.
- `?devmode=true`, mock controls, mock time, Storybook, and test harnesses
  Internal tooling retained for development, not stable product promises.

## Source Of Truth Outside `src/`

- `src-useq/`
  Authoritative firmware and WASM source. Run `npm run src-useq:status` before firmware-sensitive work.
- `.beads/config.yaml`
  Shared Beads backend defaults. See `docs/BEADS_BACKEND.md` for the actual backend workflow.

## Archive And Non-Authoritative Surfaces

- `history/`
  Audit runs, planning notes, and archived artifacts. Useful as evidence, not as current product truth.
- `scripts/documentation/`
  Historical helper scripts for old documentation data pipelines. Not part of the current build or authoritative runtime documentation surface.
- `.beads/issues.jsonl`
  Backup artifact for issue state, not the canonical Beads source of truth.

## When Adding Or Changing Docs

- Update `docs/STABLE_CORE.md` for product-boundary changes.
- Update `docs/RUNTIME_CONTRACT.md` for hardware or WASM contract changes.
- Update `docs/PROTOCOL.md` for wire-level protocol changes.
- Add or amend an ADR in `docs/adr/` when a design decision changes the expected long-term repo shape.
