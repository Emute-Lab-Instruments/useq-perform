# Map

Web live-coding interface for the **uSEQ** Eurorack module. SolidJS + Vite + CodeMirror 6 frontend; the same C++ ModuLisp interpreter that runs on hardware is vendored as the `src-useq/` submodule and compiled to WASM for browser-local execution. Hardware talks over Web Serial (JSON protocol on firmware ≥ 1.2.0). One bundle, one editor, one transport.

Terminology source of truth: [docs/GLOSSARY.md](docs/GLOSSARY.md). Read [CLAUDE.md](CLAUDE.md) before treating this map as complete; for opinionated diagnoses see `ALIGNMENT.md`.

## Top-level layout

- `src/` — application source (TypeScript/TSX). Entry: `src/main.ts` → `src/runtime/bootstrap.ts`.
- `src-useq/` — firmware submodule. Authoritative for editor-facing firmware/WASM behaviour. Run `npm run src-useq:status` before firmware-sensitive work.
- `deps/modulisp/` — ModuLisp language submodule.
- `inspector/` — same-repo Vite dev tool for visually reviewing scenarios in isolation. See [inspector/CLAUDE.md](inspector/CLAUDE.md). Run `npm run inspector` (port 5555).
- `harness/` — shared scenario harness (editor + extension registry) reused by Inspector and Storybook.
- `stories/` — Storybook stories grouped by feature area.
- `.storybook/` — Storybook config + Vitest browser-test setup.
- `test/` — Mocha integration tests (`*.mjs`) plus structural YAML fixtures under `test/new_structural/`.
- `public/` — static assets and build outputs (`public/solid-dist/bundle.js`, `public/wasm/useq.js`).
- `assets/` — source markdown/JSON/font assets copied to `public/` by `scripts/build-assets.mjs`.
- `scripts/` — build-assets pipeline, config-server (dev), `src-useq:status`, parse-tree printer.
- `plugins/` — `babel-solid-label.cjs` (dev-mode `data-component`/`data-source` annotations).
- `patches/` — patch-package patches for npm deps.
- `docs/` — architecture and contract docs (see index below).
- `history/` — dated planning notes and audit artifacts. Archival, not authoritative.
- `ai/` — agent feature/prompt scratch. Archival.

## src/ subdirectories

Layered top-to-bottom; import boundaries enforced by `eslint.config.js`.

- `src/lib/` — foundation. No imports from runtime/effects/ui/editors/transport.
  - `settings/` — schema, normalization, persistence (split out of the old `appSettings.ts`).
  - `keybindings/` — action registry, resolver, layouts, profiles, sticky modifiers, OS-reserved key list. See [docs/KEYBINDING_SYSTEM.md](docs/KEYBINDING_SYSTEM.md).
  - `editorStore.ts`, `editorDefaults.ts`, `editorCompartments.ts` — CodeMirror facade and config.
  - `typedChannel.ts` — pub/sub primitive used by everything in `contracts/`.
  - `persistence.ts` — central localStorage service (typed keys, nosave, error recovery).
  - `appSettings.ts` — thin re-export shim over `settings/` modules.
  - `gamepadManager.ts`, `gamepadIntents.ts`, `manualControlState.ts` — gamepad input.
  - `pickerMenuModel.ts`, `referenceDataLoader.ts`, `helpContentPreloader.ts`.
  - `CircularBuffer.ts`, `debug.ts`, `perfTrace.ts`, `themes.ts`, `versionUtils.ts`, `visualisationUtils.ts`, `useActorSignal.ts`.
- `src/contracts/` — shared types/constants and typed channel definitions. See [docs/REACTIVE_FLOW.md](docs/REACTIVE_FLOW.md) for channel inventory.
  - `runtimeChannels.ts`, `visualisationChannels.ts`, `gamepadChannels.ts` — channel registries.
  - `useqRuntimeContract.ts` — shared transport command set and capability split. See [docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md).
  - `wasmAbi.ts` — required + runtime-probed WASM exports, `assertWasmAbi()` validator.
  - `runtimePorts.ts` — typed `WebSerialHostPort` / `WasmRuntimePort` interfaces over the shared transport surface. The runtime layer talks to ports, not transport modules directly. `WasmRuntimePort` is shaped to be the postMessage boundary for the upcoming worker move.
  - `runtimeEvents.ts`, `runtimeTypes.ts`, `visualisationEvents.ts`.
- `src/transport/` — Web Serial lifecycle and protocol. No UI/editor imports.
  - `connector.ts` — port open/close/reconnect, Web Serial events.
  - `json-protocol.ts` — firmware ≥ 1.2.0 JSON driver (handshake, heartbeat, eval). See [docs/PROTOCOL.md](docs/PROTOCOL.md).
  - `stream-parser.ts` — byte-level parser, routes STREAM/JSON/TEXT, owns 9 `CircularBuffer`s.
  - `webSerialHostPort.ts` — adapter over `connector.ts` + `json-protocol.ts` implementing the `WebSerialHostPort` contract from `src/contracts/runtimePorts.ts`.
  - `serial-utils.ts`, `upgradeCheck.ts`, `types.ts`, `index.ts`.
  - Tests: `serialComms.test.ts` (parser, framing, eval/meta routing) and `serialLifecycle.test.ts` (Web Serial event wiring, auto-reconnect, saved-port matching, bootloader handoff, firmware version gating, post-handshake flow). Both use the same fake-Serial harness pattern.
- `src/runtime/` — bootstrap, lifecycle, runtime services. May import UI only from `bootstrap.ts` and `appLifecycle.ts` (eslint exceptions).
  - `bootstrap.ts` — startup orchestration: config load, UI mount, app lifecycle. Includes startup-mode selection (formerly `bootstrapPlan.ts`).
  - `appLifecycle.ts` — top-level lifecycle (orientation lock, about modal, vis panel toggle).
  - `runtimeService.ts` — sole settings-mutation surface; thin façade over the services below.
  - `runtimeSettingsService.ts`, `runtimeTransportService.ts`, `runtimeSessionService.ts` — split runtime concerns. Both transport- and session-services now talk to runtime ports rather than `transport/` or `wasmInterpreter` directly.
  - `runtimeSession.ts`, `runtimeSessionStore.ts` — hardware-vs-WASM precedence, plain-JS listener store.
  - `appSettingsRepository.ts` — canonical settings store (non-reactive). Mirrored into `settingsStore` via `settingsChanged` channel.
  - `wasmInterpreter.ts` — WASM module load, ABI validation, eval/sample bindings, diagnostics readback. Wrapped by `wasmRuntimePort.ts` for callers.
  - `wasmRuntimePort.ts` — adapter over `wasmInterpreter.ts` implementing the `WasmRuntimePort` contract. Surface is structured-cloneable / async / one-shot so it can become a worker postMessage boundary without re-shaping callers. Protocol-shaped operations (eval, transport commands) flow through `wasmJsonTransport.ts`; sampling-shaped operations stay direct.
  - `wasmJsonTransport.ts` — in-memory virtual transport that lets the WASM port speak the same `hello` / `stream-config` / `eval` / `ping` JSON protocol as hardware. Mirrors `transport/json-protocol.ts` at the message-shape level (no byte framing).
  - `wasmJsonHandlers.ts` — pure WASM-side request handlers for the JSON protocol. Dispatches `hello` / `ping` / `stream-config` / `eval` against an injected `WasmJsonBackend`.
  - `wasmRuntimeWorkerPort.ts` — alternative `WasmRuntimePort` that proxies every method to a dedicated Web Worker hosting the WASM interpreter. Opt-in via `?wasmInWorker=true`; default off. Diagnostics readback is not piped across the boundary in this iteration.
  - `activeWasmRuntimePort.ts` — read-through accessor returning the active `WasmRuntimePort` (in-process default, worker-backed when the opt-in flag is set). Bootstrap is the only writer.
  - `workers/wasmRuntime.worker.ts` + `workers/wasmRuntimeWorkerProtocol.ts` — classic Web Worker hosting the WASM interpreter and the discriminated-union request/response protocol it speaks.
  - `runtimeDiagnostics.ts` — startup/environment diagnostics surface.
  - `startupContext.ts` — URL flag parsing and bootstrap context (incorporates the former `urlParams.ts`).
  - `configManager.ts` + `default-config.json` — internal dev tooling for config import/export (paired with `scripts/config-server.mjs`).
  - `jsonProtocol.ts` — lightweight in-runtime helpers (distinct from `transport/json-protocol.ts`).
- `src/effects/` — composable side-effect modules. Framework-agnostic where possible.
  - `transportOrchestrator.ts`, `transportClock.ts` — XState-driven transport state and clock policy.
  - `localClock.ts` — rAF-driven mock time when no hardware.
  - `editor.ts`, `editorEvaluation.ts` — editor-side eval orchestration (eslint exception: imports editors).
  - `visualisationSampler.ts` — WASM batch sampling, sequence-guarded.
  - `mockControlInputs.ts`, `devmodeWebSocketServer.ts`, `perfBenchmark.ts`.
- `src/editors/` — CodeMirror layer. Imports lib/contracts/effects/transport.
  - `extensions.ts` — extension barrel.
  - `extensions/structure/` — AST, decorations, eval-integration, eval-state.
  - `extensions/probes.ts`, `probeHelpers.ts` — inline probe widgets (DI-configured).
  - `extensions/inlineResults.ts` — inline eval result display (DI-configured).
  - `extensions/diagnostics.ts` — error/warning squiggles wired to WASM diagnostics.
  - `extensions/evalHighlight.ts`, `extensions/visReadability.ts`, `extensions/structure.ts`.
  - `keymaps.ts`, `editorKeyboard.ts`, `gamepadNavigation.ts`, `themes.ts`.
- `src/ui/` — Solid components. Leaf layer; can import from anywhere.
  - `MainToolbar.tsx`, `TransportToolbar.tsx` — top-level toolbars (props-based, with Wired wrappers in `adapters/`).
  - `Modal.tsx`, `ProgressBar.tsx`, `Tabs.tsx`, `OnboardingBanner.tsx`, `SerialVis.tsx`, `VisLegend.tsx`, `InternalVis.tsx`.
  - `RadialMenu.tsx`, `DoubleRadialPicker.tsx`, `PickerMenu.tsx`, `HierarchicalPickerMenu.tsx`, `overlayManager.ts`.
  - `adapters/` — imperative mount bridges via `createSolidAdapter()` (toolbars, panels, modal, picker-menu, double-radial-menu, snippets, settings, visualisation, palette, modifier-hints, gamepad-menu-bridge, visualisation-panel).
  - `settings/` — settings panel + per-section components (General/Editor/Theme/Visualisation/Storage/Personal/Console/UI/EvalResults/Advanced/ConfigurationManagement). Built on `FormControls.tsx`. `devmodeContext.ts` gates `level="advanced"` rows/sections behind `?devmode=true`.
  - `help/` — help panel, ModuLisp reference tab, code snippets, keybindings tab, snippet modal, `helpChannels.ts`. Sub-dirs: `guide/` (chapter-based user guide, live probes, playground), `lessons/` (`MiniVis.tsx`).
  - `keybindings/` — `KeybindingsPanel.tsx`, `KeyboardVisualiser.tsx`, `ActionPalette.tsx`, `ModifierHints.tsx`.
  - `console/` — `ConsolePanel.tsx` REPL/log panel + CSS.
  - `panel-chrome/` — drawer/pane/tile chrome primitives + CSS.
  - `visualisation/` — `serialVis.ts` (canvas 2D painter, default) and `serialVisGL.ts` (WebGL2 painter, devmode-gated). Both register as `VisualisationRenderHook` via `adapters/visualisationPanel.ts`. Sampling/state live in `effects/visualisationSampler.ts` and `utils/visualisationStore.ts`.
  - `styles/` — all app CSS (entry: `index.css`).
- `src/utils/` — SolidJS reactive stores and small helpers.
  - `settingsStore.ts` — reactive mirror of `appSettingsRepository`.
  - `visualisationStore.ts`, `consoleStore.ts`, `referenceStore.ts`, `snippetStore.ts`, `outputHealthStore.ts`.
  - `geometry.ts`, `network.ts`, `sanitize.ts`.
- `src/machines/` — XState machines. Currently `transport.machine.ts` only.
- `src/types/` — ambient declarations (`web-serial.d.ts`).
- `src/build/` — build-time tests (`single-bundler.test.ts`).

## Key files

- `src/main.ts` — Vite entrypoint; imports CSS, calls `bootstrap()`.
- `src/runtime/bootstrap.ts` — startup orchestration; only place wiring runtime → UI/editors.
- `src/contracts/wasmAbi.ts` — single source of truth for WASM exports the editor consumes.
- `src/contracts/useqRuntimeContract.ts` — shared transport command floor.
- `vite.config.ts` — single bundle from `src/main.ts` to `public/solid-dist/`; defines Vitest `unit` + `storybook` projects.
- `eslint.config.js` — import-boundary zones with documented per-file exceptions.
- `tsconfig.json` — TS settings (strict, no `@ts-nocheck` permitted).
- `scripts/build-assets.mjs` — copies markdown/reference/wasm/fonts into `public/`.
- `scripts/config-server.mjs` — local dev config-write endpoint (paired with `runtime/configManager.ts`).
- `package.json` — see scripts: `dev`, `build`, `build:assets`, `build:wasm`, `test:mocha`, `test:unit`, `test:all`, `lint`, `typecheck`, `storybook`, `inspector`, `inspector:validate`, `src-useq:status`.

## Conventions

- TypeScript-only under `src/`; no `@ts-nocheck`.
- Inter-module communication uses **typed channels** (`src/lib/typedChannel.ts` + definitions in `src/contracts/`); never `CustomEvent` or globals.
- All localStorage access goes through **`src/lib/persistence.ts`** (typed keys, `?nosave`, JSON error recovery).
- Settings mutations go through **`runtimeService.updateSettings()`**; external code reads via `settingsStore`.
- Spelling: British English (visualisation, colour, analogue) unless an external API forces otherwise.
- Import boundaries enforced; run `npm run lint`. Documented exceptions live in `eslint.config.js`.
- CodeMirror extensions that need runtime globals use a **Config interface + factory** pattern (e.g. `ProbeConfig` / `createProbeExtensions()`), with a `createDefaultXxxConfig()` wiring app singletons. Lets extensions render in Inspector/Storybook in isolation.
- UI components accept data + callbacks as props; "Wired" wrappers in `src/ui/adapters/` read singletons and pass them down.
- During `npm run dev`, every PascalCase Solid component gets `data-component` / `data-source` attrs via `plugins/babel-solid-label.cjs`. Stripped from production.

## Linked docs index

- [docs/GLOSSARY.md](docs/GLOSSARY.md) — terminology, single source of truth for naming.
- [docs/STABLE_CORE.md](docs/STABLE_CORE.md) — product boundary, stable workflows, compatibility cuts.
- [docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md) — editor↔hardware/WASM capability split, WASM ABI floor, promotion workflow.
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — serial framing, JSON message shapes.
- [docs/REACTIVE_FLOW.md](docs/REACTIVE_FLOW.md) — stores, channels, signals, data flow paths.
- [docs/KEYBINDING_SYSTEM.md](docs/KEYBINDING_SYSTEM.md) — unified keybinding architecture.
- [docs/INSPECTOR_SPEC.md](docs/INSPECTOR_SPEC.md) — Inspector design.
- [docs/USER_GUIDE_SPEC.md](docs/USER_GUIDE_SPEC.md) — in-app user guide design.
- [docs/BEADS_BACKEND.md](docs/BEADS_BACKEND.md) — bd / Dolt backend setup.
- [docs/adr/](docs/adr/) — architectural decisions (`0001` runtime surfaces, `0002` config-manager scope, `0003` archive boundaries).
- [src-useq/docs/ERROR_HANDLING_SPEC.md](src-useq/docs/ERROR_HANDLING_SPEC.md) — diagnostic system contract.
- [inspector/CLAUDE.md](inspector/CLAUDE.md) — Inspector agent guide.

## Local gotchas

- `src-useq/` and `deps/modulisp/` are git submodules; commits there go through their own repos. Run `npm run src-useq:status` to see the pinned commit.
- The browser WASM bundle (`public/wasm/useq.js`) is built from `src-useq/` via `npm run build:wasm` and copied by `npm run build:assets`. Rebuild both after touching the interpreter source.
- `appSettingsRepository` (canonical) and `settingsStore` (reactive Solid mirror) are separate. UI reads the store; mutations go through `runtimeService`.
- `serialBuffers` in `transport/stream-parser.ts` are imperative `CircularBuffer`s, not part of the Solid store.
- `?nosave` URL param fully bypasses persistence; useful in tests.
- Dev mode (`npm run dev`) injects `data-component` attrs; production builds strip them.
- `src/runtime/jsonProtocol.ts` and `src/transport/json-protocol.ts` are different files — the transport one is the wire driver, the runtime one is in-runtime helpers.
- `src/lib/appSettings.ts` is now a thin re-export; the real schema/normalisation/persistence live under `src/lib/settings/`.
- `scripts/documentation/` is archival (pre-current pipelines); ignored by ESLint and not part of the live build.
- bd uses a Dolt-backed backend in this repo; sync via `bd dolt push`/`bd dolt pull`, not `bd sync`.

## Strategic concerns

See `ALIGNMENT.md` for opinionated diagnosis of gaps and defects.
