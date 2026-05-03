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
  - `settings/` — schema, normalization, persistence (split out of the old `appSettings.ts`). Normalization is further split: `normalizationHelpers.ts`, `normalizeEvalResults.ts`, `normalizeKeybindings.ts`, `normalizeVisualisation.ts`. Includes `HardwareSettings` (bindingsEnabled, bindingFoldDefault, bindingQueueDepth, holdTickHz) per [docs/specs/hardware-bindings.md §6](docs/specs/hardware-bindings.md).
  - `keybindings/` — action registry (with `reversible` flag, derives `ReversibleActionId`/`NonReversibleActionId`), `defaults.ts` (default binding data), `handlers.ts` (action → implementation dispatch), resolver, `layouts/` (qwerty-us/uk, dvorak, colemak, azerty-fr, qwertz-de), `profiles/` (including `simplified.ts`), sticky modifiers, OS-reserved key list. See [docs/specs/keybindings.md](docs/specs/keybindings.md).
  - `editorStore.ts`, `editorDefaults.ts`, `editorCompartments.ts` — CodeMirror facade and config.
  - `typedChannel.ts` — pub/sub primitive used by everything in `contracts/`.
  - `persistence.ts` — central localStorage service (typed keys, nosave, error recovery).
  - `appSettings.ts` — thin re-export shim over `settings/` modules.
  - `gamepad/` — **three-stage gamepad pipeline** (spec: `docs/specs/gamepad.md`). `gamepadManager.ts` (hardware polling, snapshot normalisation, GamepadManager class), `types.ts` (full type vocabulary including Layer, Resolution, DualBinding), `gestures.ts` (smart constructors + keyOf), `recognizer.ts` (Stage 2: pure gesture recognition), `resolver.ts` (Stage 3: layer-stack resolution), `dispatcher.ts` (eager-with-undo action dispatch), `hardware.ts` (Stage 1: snapshot diffing to LogicalEvent[]), `index.ts` (full pipeline wiring). Paradigms: `paradigms/{picker,modal-shift,leader,hydra,chord-heavy}.ts`.
  - `manualControlState.ts` — manual control state tracking.
  - `pickerMenuModel.ts`, `referenceDataLoader.ts`, `helpContentPreloader.ts`.
  - `CircularBuffer.ts`, `debug.ts`, `perfTrace.ts` (DEV-only profiling — `window.__useqPerf.{enable,report,reset}`, timings + counters; tree-shaken in prod via `import.meta.env.DEV` gates at every call site), `themes.ts`, `versionUtils.ts`, `visualisationUtils.ts`, `useActorSignal.ts`.
- `src/contracts/` — shared types/constants and typed channel definitions. See [docs/specs/reactive-flow.md](docs/specs/reactive-flow.md) for channel inventory.
  - `runtimeChannels.ts`, `visualisationChannels.ts`, `gamepadChannels.ts`, `hardwareChannels.ts`, `editorChannels.ts` — channel registries. `hardwareChannels.ts` carries discrete hardware input events (button presses, toggle flips, gate edges). `editorChannels.ts` carries structural navigation/mutation events consumed by radial menu and keyboard hints.
  - `useqRuntimeContract.ts` — shared transport command set and capability split. See [docs/specs/runtime-contract.md](docs/specs/runtime-contract.md).
  - `wasmAbi.ts` — required + runtime-probed WASM exports, `assertWasmAbi()` validator.
  - `runtimePorts.ts` — typed `WebSerialHostPort` / `WasmRuntimePort` interfaces over the shared transport surface. The runtime layer talks to ports, not transport modules directly. `WasmRuntimePort` is shaped to be the postMessage boundary for the upcoming worker move.
  - `runtimeEvents.ts`, `runtimeTypes.ts`, `visualisationEvents.ts`.
  - `liveEdit.ts` — live-edit slot/widget/vector-mark types ([docs/specs/live-edit.md](docs/specs/live-edit.md)).
  - `midi.ts` — Web MIDI input types: device descriptor, parsed messages, learn state, source/binding model ([docs/specs/live-edit.md §5.6+](docs/specs/live-edit.md)).
  - `hardware.ts` — hardware binding chip + CV calibration session types ([docs/specs/hardware-bindings.md](docs/specs/hardware-bindings.md), [docs/specs/calibration.md](docs/specs/calibration.md)).
- `src/transport/` — Web Serial lifecycle and protocol. No UI/editor imports.
  - `connector.ts` — port open/close/reconnect, Web Serial events.
  - `json-protocol.ts` — firmware ≥ 1.2.0 JSON driver (handshake, heartbeat, eval). See [src-useq/docs/specs/wire-protocol.md](src-useq/docs/specs/wire-protocol.md).
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
  - `wasmRuntimeWorkerPort.ts` — default `WasmRuntimePort` in browsers with Web Worker support; proxies every method to a dedicated classic Worker hosting the WASM interpreter. The in-process port is the fallback when Workers are unavailable or fail to construct. Diagnostics readback is piped through worker request/response messages.
  - `activeWasmRuntimePort.ts` — read-through accessor returning the active `WasmRuntimePort` (worker-backed by default, in-process fallback). Bootstrap is the only writer.
  - `workers/wasmRuntime.worker.ts` + `workers/wasmRuntimeWorkerProtocol.ts` — classic Web Worker hosting the WASM interpreter and the discriminated-union request/response protocol it speaks.
  - `runtimeDiagnostics.ts` — startup/environment diagnostics surface.
  - `startupContext.ts` — URL flag parsing and bootstrap context (incorporates the former `urlParams.ts`).
  - `configManager.ts` + `default-config.json` — internal dev tooling for config import/export (paired with `scripts/config-server.mjs`).
  - `jsonProtocol.ts` — lightweight in-runtime helpers (distinct from `transport/json-protocol.ts`).
- `src/effects/` — composable side-effect modules. Framework-agnostic where possible.
  - `transportOrchestrator.ts`, `transportClock.ts` — XState-driven transport state and clock policy.
  - `localClock.ts` — rAF-driven internal clock when no hardware.
  - `editor.ts`, `editorEvaluation.ts` — editor-side eval orchestration (eslint exception: imports editors).
  - `visualisationSampler.ts` — WASM sampling with event-driven future projection. Past buffer (one sample/frame) + future buffer (batch-refilled on invalidation, extended one sample/frame).
  - `hardwareBindingDispatcher.ts` — dispatches bound expressions on hardware button events. Subscribes to `hwInput` channel, scans editor doc for `(on-press|on-release|on-button|on-toggle)` forms, evals via WASM + hardware with per-binding FIFO queue and hold-tick coalescing ([docs/specs/hardware-bindings.md §4](docs/specs/hardware-bindings.md)). Editor-layer chip sync is injected via `DispatcherConfig` to respect import boundaries.
  - `liveEditStore.ts` — reactive live-edit slot store (current values, widget states, reconciliation).
  - `liveEditPersistence.ts` — live-edit persistence layer (debounced localStorage writes, orphan GC, reconciliation triggers per spec §7).
  - `midiInput.ts` — Web MIDI input enumeration and raw message parsing ([docs/specs/live-edit.md §5.6](docs/specs/live-edit.md)).
  - `midiLearnController.ts` — MIDI learn state machine (per-widget and batch-learn flows per spec §5.8).
  - `midiRouter.ts` — routes parsed MIDI CC/note messages to bound live-edit slots per spec §5.7.
  - `calibrationSequencer.ts` — CV 1V/oct calibration session state machine (wire-protocol-driven; manages begin/adjust/save-point/end lifecycle per [docs/specs/calibration.md](docs/specs/calibration.md)).
  - `driftDetector.ts` — per-output EMA drift scoring comparing hardware stream values against WASM tick values. Publishes `driftDetected` channel when aggregate exceeds threshold ([docs/specs/state-sync.md](docs/specs/state-sync.md)).
  - `stateSyncOrchestrator.ts` — subscribes to `driftDetected`, requests hardware state snapshot, applies to WASM. Manages cooldown, in-flight state, console feedback ([docs/specs/state-sync.md](docs/specs/state-sync.md)).
  - `mockControlInputs.ts`, `perfBenchmark.ts` (DEV-only — `window.__useqBench.run(channelCount)` exercises the vis pipeline at scale).
- `src/editors/` — CodeMirror layer. Imports lib/contracts/effects/transport.
  - `extensions.ts` — extension barrel.
  - `extensions/structure/` — structural-editing core. `core/` holds the pure functional tree/cursor logic + nav/mutate ops + hole helpers + traversal + type vocabulary. `adapter/` holds the CodeMirror binding: `stateField.ts`, `nodeOverlays.ts` (SVG overlay for cursor halos, indent guides, node polygons), `holeWidget.ts` (hole pill widgets), `dispatcher.ts` (op dispatch), `treeFromLezer.ts`, `gamepadBridge.ts`, `spatialNav.ts` (vertical spatial nav using source positions), `applyOp.ts` (structural op application), `cursorFromSelection.ts`, `cursorPath.ts`, `extension.ts`, `printTree.ts`. Both layers have `__tests__/` dirs.
  - `extensions/expressionHighlights.ts`, `expressionEval.ts`, `expressionEvalState.ts`, `expressionEvalDefaults.ts` — code-evaluation feedback (gutter pills, play-button DOM, last-evaluated tracking, Lezer-driven expression-bounds detection).
  - `extensions/lezerHelpers.ts` — Lezer/AST helpers (`findNodeAt`, `getTrimmedRange`, `getContainerNodeAt`, `isStructuralToken`, `isContainerNode`, `isOperatorNode`) used by callers outside the structural-editing core.
  - `extensions/probes.ts`, `probeHelpers.ts` — inline probe widgets (DI-configured).
  - `extensions/inlineResults.ts` — inline eval result display (DI-configured).
  - `extensions/diagnostics.ts` — error/warning squiggles wired to WASM diagnostics.
  - `extensions/evalHighlight.ts`, `extensions/visReadability.ts`.
  - `extensions/liveEdit/` — live-edit editor layer. `widgets.ts` (inline knob/slider/toggle/picker per spec §4), `vectorMarking.ts` (solid/dotted underlines for vector-mark sub-mode per spec §3.7), `markAction.ts` (mark/unmark action per spec §3), `rangeInference.ts` (`:min`/`:max` auto-inference per spec §3.4), `vectorMarkController.ts` (vector-mark sub-mode state machine per spec §3.7), `widgetStoreBridge.ts` (connects live-edit store to CodeMirror widgets). Tests in `__tests__/`.
  - `extensions/hardwareBinding/chipWidget.ts` — inline chips for `(on-press|on-release|on-button|on-toggle :sw1 …)` wrappers, with status dot, lifecycle indicator, fired-pulse and error states ([docs/specs/hardware-bindings.md §3](docs/specs/hardware-bindings.md)).
  - `keymaps.ts`, `editorKeyboard.ts`, `gamepadNavigation.ts`, `themes.ts`.
- `src/ui/` — Solid components. Leaf layer; can import from anywhere.
  - `MainToolbar.tsx`, `TransportToolbar.tsx` — top-level toolbars (props-based, with Wired wrappers in `adapters/`).
  - `Modal.tsx`, `ProgressBar.tsx`, `Tabs.tsx`, `OnboardingBanner.tsx`, `SerialVis.tsx`, `VisLegend.tsx`, `InternalVis.tsx`.
  - `RadialMenu.tsx`, `DoubleRadialPicker.tsx`, `PickerMenu.tsx`, `HierarchicalPickerMenu.tsx`, `overlayManager.ts`.
  - `adapters/` — imperative mount bridges via `createSolidAdapter()` (toolbars, panels, modal, picker-menu, double-radial-menu, snippets, settings, visualisation, palette, modifier-hints, gamepad-menu-bridge, visualisation-panel, `liveEditPanel.tsx` for the dockable live-edit panel, `calibration.tsx` for the full-screen calibration takeover).
  - `settings/` — settings panel + per-section components (General/Editor/Theme/Visualisation/Storage/Personal/Console/UI/EvalResults/Advanced/ConfigurationManagement/Midi). Built on `FormControls.tsx`. `devmodeContext.ts` gates `level="advanced"` rows/sections behind `?devmode=true`. `MidiSettings.tsx` covers Web MIDI input enumeration + permission flow ([docs/specs/live-edit.md §5.6](docs/specs/live-edit.md)).
  - `liveEdit/` — dockable live-edit panel (`LiveEditPanel.tsx`, `LiveEditCard.tsx`) + MIDI learn UX pieces (`MidiLearnAffordance.tsx`, `MidiLearnBanner.tsx`, `MidiLearnConflict.tsx`). Pure prop-driven; the runtime-binding flow (gii8.43 follow-up) wires actual MIDI event subscriptions.
  - `calibration/` — full-screen CV 1V/oct calibration takeover (`CalibrationTakeover.tsx`, `CalibrationPicker.tsx`, `CalibrationSlider.tsx`, `CalibrationProgress.tsx`, `CalibrationCompleteBanner.tsx`) per [docs/specs/calibration.md](docs/specs/calibration.md). UI shell only; the wire-protocol-driven session state machine is gii8.60.
  - `help/` — help panel, ModuLisp reference tab, code snippets, keybindings tab, snippet modal, `helpChannels.ts`. Sub-dirs: `guide/` (chapter-based user guide, live probes, playground), `lessons/` (`MiniVis.tsx`).
  - `keybindings/` — `KeybindingsPanel.tsx`, `KeyboardVisualiser.tsx`, `ActionPalette.tsx`, `ModifierHints.tsx`.
  - `console/` — `ConsolePanel.tsx` REPL/log panel + CSS.
  - `panel-chrome/` — drawer/pane/tile chrome primitives + CSS.
  - `visualisation/` — `serialVisGL.ts` (WebGL2 renderer), `webglLineRenderer.ts` (low-level WebGL line drawing). Render hooks register via `adapters/visualisationPanel.ts`. Sampling/state live in `effects/visualisationSampler.ts` and `utils/visualisationStore.ts`.
  - `styles/` — all app CSS (entry: `index.css`).
- `src/zen/` — Zen Mode: distraction-free structural-editing practice environment. See [docs/specs/zen-mode.md](docs/specs/zen-mode.md).
  - `index.tsx` — entry point (`isZenRoute()`, `mountZenMode()`); route: `/zen/#/{exerciseId}`.
  - `ZenMode.tsx` — full-screen exercise container with grid/exercise view state machine.
  - `ZenGrid.tsx` — exercise selection grid.
  - `ZenExercise.tsx` — single exercise rendering + real-time validation.
  - `exercises.ts` — exercise definitions and category management.
  - `store.ts` — state store (current exercise, view mode, detected input, progress).
  - `progress.ts` — score/progress tracking.
  - `hints.ts` — hint generation for exercises.
  - `validation.ts` — exercise validation logic.
  - `sequenceTracker.ts` — input sequence tracking.
  - `zenKeymapGuard.ts` — prevents accidental keybindings during Zen Mode.
  - `zenNavigation.ts` — navigation/routing helpers.
- `src/utils/` — SolidJS reactive stores and small helpers.
  - `settingsStore.ts` — reactive mirror of `appSettingsRepository`.
  - `visualisationStore.ts`, `consoleStore.ts`, `referenceStore.ts`, `snippetStore.ts`, `outputHealthStore.ts`.
  - `geometry.ts`, `sanitize.ts`.
- `src/machines/` — XState machines. `transport.machine.ts` (transport state) + `test.machine.ts` (test/example machine).
- `src/types/` — ambient declarations (`web-serial.d.ts`, `clojure-mode.d.ts`).
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
- [docs/specs/MAIN.md](docs/specs/MAIN.md) — normative app-behaviour spec (split into per-feature sub-specs under `docs/specs/`); source of truth for tests and correctness. §4 covers product boundary, stable core, compatibility cuts, and out-of-scope items.
- [docs/specs/runtime-contract.md](docs/specs/runtime-contract.md) — editor↔hardware/WASM capability split, WASM ABI floor, promotion workflow.
- [src-useq/docs/specs/wire-protocol.md](src-useq/docs/specs/wire-protocol.md) — serial framing, JSON message shapes.
- [docs/specs/reactive-flow.md](docs/specs/reactive-flow.md) — stores, channels, signals, data flow paths.
- [docs/specs/keybindings.md](docs/specs/keybindings.md) — unified keybinding architecture.
- [docs/specs/inspector.md](docs/specs/inspector.md) — Inspector design.
- [docs/specs/user-guide.md](docs/specs/user-guide.md) — in-app user guide design.
- [docs/specs/live-edit.md](docs/specs/live-edit.md) — live-edit wrapper forms, inline widgets, panel, MIDI learn, persistence.
- [docs/specs/hardware-bindings.md](docs/specs/hardware-bindings.md) — hardware button/toggle binding wrapper forms, inline chip widgets, test-fire UX.
- [docs/specs/calibration.md](docs/specs/calibration.md) — CV 1V/oct calibration full-screen takeover flow.
- [docs/specs/structural-editing.md](docs/specs/structural-editing.md) — focus-primary ontology, Metas, holes, nav/mutate algebra.
- [docs/specs/input-dispatch.md](docs/specs/input-dispatch.md) — command router as single chokepoint for editor-directed intents.
- [docs/specs/radial-menu.md](docs/specs/radial-menu.md) — gamepad-driven double-ring command surface.
- [docs/specs/zen-mode.md](docs/specs/zen-mode.md) — distraction-free structural editing practice environment.
- [docs/specs/gamepad-handoff.md](docs/specs/gamepad-handoff.md) — gamepad pipeline rebuild status (working document).
- [docs/BEADS_BACKEND.md](docs/BEADS_BACKEND.md) — bd / Dolt backend setup.
- [docs/adr/](docs/adr/) — architectural decisions (`0001` runtime surfaces, `0002` config-manager scope, `0003` archive boundaries).
- [src-useq/docs/specs/diagnostics.md](src-useq/docs/specs/diagnostics.md) — diagnostic data shapes and ABI; see [src-useq/docs/specs/failure-model.md](src-useq/docs/specs/failure-model.md) for failure semantics.
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
