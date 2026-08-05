# Map

Web live-coding interface for the **uSEQ** Eurorack module. SolidJS + Vite + CodeMirror 6 frontend; the same C++ ModuLisp interpreter that runs on current hardware is vendored as the `src-useq/` submodule and compiled to WASM for browser-local execution. Hardware talks over Web Serial using protocol-v1 JSON or a bounded pre-1.2 text compatibility adapter. One bundle, one editor, one transport.

Terminology source of truth: [docs/GLOSSARY.md](docs/GLOSSARY.md). Read [CLAUDE.md](CLAUDE.md) before treating this map as complete; for opinionated diagnoses see `ALIGNMENT.md`.

## Top-level layout

- `src/` — application source (TypeScript/TSX). Entry: `src/main.ts` → `src/runtime/bootstrap.ts`.
- `src-useq/` — firmware submodule. Authoritative for editor-facing firmware/WASM behaviour. Run `npm run src-useq:status` before firmware-sensitive work.
- `deps/modulisp/` — ModuLisp language submodule.
- `inspector/` — same-repo Vite dev tool for visually reviewing scenarios in isolation. See [inspector/CLAUDE.md](inspector/CLAUDE.md). Run `npm run inspector` (port 5555).
- `grammar-lab/` — standalone Solid/Vite research instrument for comparing versioned keyboard/gamepad motor grammars against the same structural meaning. It is deliberately isolated from production settings, persistence, transport, and runtime state. Run `npm run grammar-lab` (port 5566).
- `harness/` — shared scenario harness (editor + extension registry) reused by Inspector and Storybook.
- `stories/` — Storybook stories grouped by feature area.
- `.storybook/` — Storybook config + Vitest browser-test setup.
- `test/` — Mocha integration tests (`*.mjs`) plus structural YAML fixtures under `test/new_structural/`. `test/helpers/` holds the css-noop node loader (registered via `.mocharc.yml`) and the structural-fuzz worker.
- `e2e/` — Playwright full-app journeys driven by trusted browser input against the worker-backed WASM runtime. Shared fixtures in `helpers.ts`; per-area specs (boot contract, eval feedback, LKG isolation, input dispatch, original journeys). Run `npm run test:e2e` for the deterministic pinned-browser suite; `npm run test:browser-local-eval` rebuilds and runs the fundamental eval smoke in the currently installed Chrome/Chromium/Edge, and `npm run test:release` includes that current-browser gate.
- `public/` — static assets and build outputs (`public/solid-dist/bundle.js`, `public/wasm/useq.js`); `public/firmware/beta/` is the same-origin beta updater with Chromium directory-write installation and a verified-download fallback.
- `assets/` — source markdown/JSON/font assets copied to `public/` by `scripts/build-assets.mjs`.
- `scripts/` — build-assets pipeline and compiler capability-manifest verifier, current-Chromium worker-eval release gate (`run-current-chromium-eval-smoke.mjs`), beta-firmware packager (`prepare-firmware-beta.mjs`), config-server (dev), `src-useq:status`, parse-tree printer.
- `plugins/` — `babel-solid-label.cjs` (dev-mode `data-component`/`data-source` annotations).
- `patches/` — patch-package patches for npm deps.
- `docs/` — architecture and contract docs (see index below).
  - `docs/reports/ux-and-e2e-audit-2026-07-22.md` — UX, test-meaningfulness, and cross-stack E2E audit for the app plus pinned firmware.
- `history/` — dated planning notes and audit artifacts. Archival, not authoritative.
- `ai/` — agent feature/prompt scratch. Archival.

## src/ subdirectories

Layered top-to-bottom; import boundaries enforced by `eslint.config.js`.

- `src/lib/` — foundation. No imports from runtime/effects/ui/editors/transport.
  - `settings/` — schema, normalization, persistence (split out of the old `appSettings.ts`). Normalization is further split: `normalizationHelpers.ts`, `normalizeEvalResults.ts`, `normalizeKeybindings.ts`, `normalizeVisualisation.ts`. Includes `HardwareSettings` (bindingsEnabled, bindingFoldDefault, bindingQueueDepth, holdTickHz) per [docs/specs/hardware-bindings.md §6](docs/specs/hardware-bindings.md). Includes `FormatSettings` (lineWidth, complexityThreshold, minAvailableWidth, indentStyle, autoFormatOnMutation) per [docs/specs/formatting.md §5](docs/specs/formatting.md). Includes `LiveEditSettings` (idAlphabet/idLength + §10 surface) per [docs/specs/live-edit.md §10](docs/specs/live-edit.md) and `CalibrationSettings` (sliderRangeCents, snapZeroToleranceCents, fine/coarseStepCents, carryForwardOffset, …) per [docs/specs/calibration.md §9](docs/specs/calibration.md).
  - `keybindings/` — action registry (with `reversible` flag, derives `ReversibleActionId`/`NonReversibleActionId`), `defaults.ts` (default binding data), `handlers.ts` (action → implementation dispatch), resolver (merges profile defaults + overrides, evaluates `when` predicates at dispatch, ranked rebind suggestions), `profileRegistry.ts` (profile id → base binding set), `contexts.ts` (`when`-predicate registry/evaluator), `layouts/` (qwerty-us/uk, dvorak, colemak, azerty-fr, qwertz-de), `profiles/` (including `simplified.ts`), sticky modifiers, OS-reserved key list (`isMac()`/`detectOs()` is the single OS-detection source). See [docs/specs/keybindings.md](docs/specs/keybindings.md).
  - `editorStore.ts`, `editorDefaults.ts`, `editorCompartments.ts` — CodeMirror facade and config.
  - `typedChannel.ts` — pub/sub primitive used by everything in `contracts/`.
  - `persistence.ts` — central localStorage service (typed keys, nosave, error recovery).
  - `appSettings.ts` — sanctioned public barrel over `settings/` modules; canonical settings import surface (~30 importers). The `settings/` split is internal — import from here, not the sub-modules.
  - `gamepad/` — **three-stage gamepad pipeline** (spec: `docs/specs/gamepad.md`). `gamepadManager.ts` (hardware polling, snapshot normalisation, GamepadManager class), `types.ts` (full type vocabulary including Layer, Resolution, DualBinding), `gestures.ts` (smart constructors + keyOf), `recognizer.ts` (Stage 2: pure gesture recognition), `resolver.ts` (Stage 3: layer-stack resolution; honours `Layer.mask` for exclusive predicate layers and `onMiss` for transient layers), `dispatcher.ts` (eager-with-undo action dispatch), `hardware.ts` (Stage 1: snapshot diffing to LogicalEvent[]), `grabState.ts` (grab-mode state: active flag, move counter, doc/cursor snapshot for cancel-undo), `index.ts` (full pipeline wiring; forwards raw LB/RB shoulder edges to the menu dispatcher's freeze mechanic, coalescing per radial-menu.md §6.2.5). Paradigms: `paradigms/{radial,modal-shift,leader,hydra,chord-heavy}.ts` (`radial.ts` is the `when`-gated, `mask: true` radial-menu takeover layer active while the menu is open — replaced the legacy picker layer; `modal-shift.ts` includes the `grab-mode` and `main-menu` masking layers).
  - `menu/` — **radial menu system** (spec: `docs/specs/radial-menu.md`). Gamepad-driven double-ring command surface for noun insertion. `state.ts` (state machine: closed→open→committed→auto-chain, ring navigation, segment focus), `dispatcher.ts` (wires gamepad input to state machine: `menu.*` actions, stick axes, and raw shoulder freeze edges via `handleShoulder`; applies verb mutations to document; auto-chain logic), `verbs.ts` (face-button verbs: wrap/replace/insertBefore/insertAfter/splice), `manifest.ts` + `manifest.json` (ring segment content definitions per language category), `templates.ts` (template expansion from ring selections), `chain.ts` (auto-chain: reopen the menu at the next structural position after a commit), `store.ts` (reactive Solid store bridge to state), `types.ts` (full type vocabulary: Ring, Segment, Verb, ChainTarget, MenuState), `previewCache.ts` (preview text cache for ring segments). Heavily tested (`state.test.ts`, `dispatcher.test.ts`, `dispatcher.e2e.test.ts`, `verbs.test.ts`, `chain.test.ts`, `manifest.test.ts`, `templates.test.ts`, `state.property.test.ts`, performance tests).
  - `mainMenu/` — main menu state store (`store.ts`: open/closed, focus index, submenu stack). See [docs/specs/main-menu.md](docs/specs/main-menu.md).
  - `manualControlState.ts` — manual control state tracking.
  - `PastBuffer.ts` — rolling fixed-size sample buffer for per-output vis history.
  - `diagnosticGuideLinks.ts` — static diagnostic-category → guide-section map + `guideLinkForCategory()` ([docs/specs/the-machine.md](docs/specs/the-machine.md) §5.1). Pure data, so `src/editors/` can read it without importing UI. Note: the engine emits `"undefinedName"` (camelCase, `diagnostics.cpp`) while `src-useq/docs/specs/diagnostics.md` §2.3 documents `"undefined_name"`; both spellings are accepted.
  - `projectionTrace.ts` — projection-fork debug tracing (DEV-only).
  - `pickerMenuModel.ts`, `referenceDataLoader.ts`, `helpContentPreloader.ts`.
  - `witness/` — **conformance-witness substrate** (spec: [docs/specs/witnesses.md](docs/specs/witnesses.md)). `types.ts` (corpus/result shapes + the injected `WitnessEngine` seam), `loader.ts` (fetch + validate the bundled `witness-index.json` / `spec-corpus.json`; clause lookups), `runner.ts` (executes the `eval`/`sample` step kinds against an isolated engine; any other step kind or expectation makes the whole witness `unsupported`, never a pass; 1e-9 default tolerance matching `src-useq/scripts/run_conformance.py`), `nodeEngine.testkit.ts` (test-only headless adapter over the real `public/wasm/useq.{js,wasm}`).
  - `CircularBuffer.ts`, `debug.ts`, `perfTrace.ts` (DEV-only profiling — `window.__useqPerf.{enable,report,reset}`, timings + counters; tree-shaken in prod via `import.meta.env.DEV` gates at every call site), `themes.ts`, `versionUtils.ts`, `visualisationUtils.ts`, `useActorSignal.ts`.
- `src/contracts/` — shared types/constants and typed channel definitions. See [docs/specs/reactive-flow.md](docs/specs/reactive-flow.md) for channel inventory.
  - `runtimeChannels.ts`, `visualisationChannels.ts`, `gamepadChannels.ts`, `hardwareChannels.ts`, `editorChannels.ts`, `guideChannels.ts` — channel registries. `guideChannels.ts` carries user-guide navigation requests, so a diagnostic rendered by `src/editors/` can deep-link into the guide without that layer importing `src/ui/` ([docs/specs/the-machine.md](docs/specs/the-machine.md) §5.1). `hardwareChannels.ts` carries discrete hardware input events (button presses, toggle flips, gate edges). `editorChannels.ts` carries structural navigation/mutation events consumed by radial menu and keyboard hints.
  - `useqRuntimeContract.ts` — shared transport command set and capability split. See [docs/specs/runtime-contract.md](docs/specs/runtime-contract.md).
  - `wasmAbi.ts` — required + runtime-probed WASM exports, `assertWasmAbi()` validator.
  - `runtimePorts.ts` — typed `WebSerialHostPort` / `WasmRuntimePort` interfaces over the shared transport surface, including failure-atomic producer candidate prepare/abort. The runtime layer talks to ports, not transport modules directly.
  - `runtimeEvents.ts`, `runtimeTypes.ts`, `visualisationEvents.ts` — runtime payload types; `runtimeTypes.ts` also owns exhaustive, reason-bearing synth-artifact validation before audio commit.
  - `synthProducerControlMapping.ts` — pure compiler-control-index → block-rate SAB mapping and structured-clone boundary validation.
  - `liveEdit.ts` — live-edit slot/widget/vector-mark types ([docs/specs/live-edit.md](docs/specs/live-edit.md)).
  - `midi.ts` — Web MIDI input types: device descriptor, parsed messages, learn state, source/binding model ([docs/specs/live-edit.md §5.6+](docs/specs/live-edit.md)).
  - `hardware.ts` — hardware binding chip + CV calibration session types ([docs/specs/hardware-bindings.md](docs/specs/hardware-bindings.md), [docs/specs/calibration.md](docs/specs/calibration.md)).
  - `synthesisControlAbi.ts` — versioned SharedArrayBuffer control-transport ABI (header layout, ring records, publication helpers) **and** the single named-export home for engine constants (`SYNTH_FADE_IN/OUT_MS`, `CONTROL_LOOKAHEAD_BLOCKS`, `PRODUCER_TIMEOUT_BLOCKS`, `MAX_SYNTH_*`, …) per [docs/specs/synthesis.md §4](docs/specs/synthesis.md).
  - `synthesisChannels.ts` — typed channels + engine-state transition table for the synthesis engine (off/suspended/running/error).
  - `nodeDefRegistry.ts` — NodeDef descriptor schema/validation; carries the routed `osc/sine` v2 entry with named `fm` input ([src-useq/docs/specs/synth-nodes.md §2](src-useq/docs/specs/synth-nodes.md)).
  - `audioCapabilities.ts` — bootstrap `crossOriginIsolated`/SAB capability snapshot feeding the degraded no-audio diagnostic ([docs/specs/synthesis.md §6.3](docs/specs/synthesis.md)).
- `src/audio/` — browser synthesis engine (M0–M2.2 of [docs/design/synthesis-epic.md](docs/design/synthesis-epic.md); spec [docs/specs/synthesis.md](docs/specs/synthesis.md)).
  - `synthesisService.ts` — main-thread engine owner: state machine, worklet bring-up, producer bridge, serial failure-atomic prepare/commit/activate pipeline (incl. `MAX_SYNTH_NODES` + block-rate channel-pool checks), telemetry. Accessed via `src/runtime/activeSynthesisService.ts`.
  - `synthesisServiceBrowser.ts` — real-browser wiring (AudioContext construction, NodeDef WASM fetch/instantiation, fail-closed module-owned registry decoding).
  - `engineCommitCoordinator.ts` — pure eval→engine diff/plan builder (retire/instantiate/update deltas, compiler-order-preserving per-(node,param) controls with original indices, terminally exhaustible uint32 activation-epoch allocation, and audio-input wiring from required ABI-2 `connections`).
  - `workletCore.ts` + `synthesisWorklet.ts` — AudioWorkletProcessor logic (framework-free core + thin worklet shell); multi-node topological graph host with transaction-owned candidate zones, acknowledged block-boundary activation, retryable failure-atomic NodeDef blocks (preallocated state rollback + whole-zone mute), sample-indexed partition-invariant fades, and binary64 terminal mixing with one final binary32 conversion (synthesis.md §3.1/§3.3/§3.5.1/§3.6); bundled by `scripts/build-assets.mjs` into `public/wasm/synthesisWorklet.js`.
  - `workletZoneAllocator.ts` — first-fit coalescing zone allocator over the host-owned `WebAssembly.Memory` arena (synthesis.md §2.3/§3.5; bounded by `SYNTH_MEMORY_MAX_BYTES`).
  - `producerScheduler.ts` + `producerLoopDriver.ts` — Worker-side block production pacing and cancellable loop. **Deviation**: `setTimeout(0)` polling, not the ADR-0003 `Atomics.wait` (see ADR-0003 revisit note).
  - `transportFrameMap.ts`, `audioClockPolicy.ts` — pure audio-frame↔transport-time mapping.
  - `workletGraphDelta.ts`, `nodeDefAdapter.ts` — graph delta application and source-agnostic NodeDef module adapter, including module-metadata validation, named audio-input execution, and the versioned actual-sample-rate compute capability.
  - `engineIndicator.tsx` — engine state chip (props-based; wired in `src/ui/adapters/toolbars.tsx`).
- `src/transport/` — Web Serial lifecycle and protocol. No UI/editor imports.
  - `connector.ts` — port open/close/reconnect, Web Serial events.
  - `json-protocol.ts` — capability negotiation plus the protocol-v1 JSON driver (handshake, heartbeat, eval). See [src-useq/docs/specs/wire-protocol.md](src-useq/docs/specs/wire-protocol.md).
  - `legacy-protocol.ts` — isolated pre-1.2 firmware-info probe and raw ModuLisp adapter; it deliberately does not emulate the old interpreter.
  - `stream-parser.ts` — byte-level universal parser, routes STREAM/bare JSON/framed JSON/legacy text, owns 9 `CircularBuffer`s.
  - `webSerialHostPort.ts` — adapter over `connector.ts` + `json-protocol.ts` implementing the `WebSerialHostPort` contract from `src/contracts/runtimePorts.ts`.
  - `webSocketSerialPort.ts` — duck-typed Web Serial `SerialPort` over a loopback WebSocket (`?nativeBridge`); lets a native uSEQ engine (e.g. the VCV Rack plugin) appear as ordinary hardware. See [docs/specs/url-params.md](docs/specs/url-params.md).
  - `serial-utils.ts`, `upgradeCheck.ts`, `types.ts`, `index.ts`.
  - Tests: `serialComms.test.ts` (parser, framing, eval/meta routing) and `serialLifecycle.test.ts` (Web Serial event wiring, auto-reconnect, saved-port matching, bootloader handoff, firmware version gating, post-handshake flow). Both use the same fake-Serial harness pattern.
- `src/runtime/` — bootstrap, lifecycle, runtime services. May import UI only from `bootstrap.ts` and `appLifecycle.ts` (eslint exceptions).
  - `bootstrap.ts` — startup orchestration: config load, UI mount, app lifecycle. Includes startup-mode selection (formerly `bootstrapPlan.ts`).
  - `appLifecycle.ts` — top-level runtime-mode startup/teardown, browser-local activation, reconnect flow, and bootstrap-adjacent UI wiring.
  - `runtimeService.ts` — sole settings-mutation surface; thin façade over the services below.
  - `runtimeSettingsService.ts`, `runtimeTransportService.ts`, `runtimeSessionService.ts` — split runtime concerns. Both transport- and session-services now talk to runtime ports rather than `transport/` or `wasmInterpreter` directly.
  - `runtimeSession.ts`, `runtimeSessionStore.ts`, `runtimeSessionService.ts` — hardware-vs-WASM precedence and the plain-JS session store; transport/settings producers report facts explicitly, and consumers read or subscribe through `runtimeService.ts`.
  - `runtimeCompatibility.ts` — keeps the current WASM loaded but prevents it from presenting current-firmware results as a shadow of legacy hardware.
  - `appSettingsRepository.ts` — canonical settings store (non-reactive). Mirrored into `settingsStore` via `settingsChanged` channel.
  - `wasmInterpreter.ts` — main-thread WASM module loader and adapter; validates the ABI and publishes synchronous diagnostic bridges on `__useqWasmRuntime`. Wrapped by `wasmRuntimePort.ts` for callers.
  - `wasmInterpreterCore.ts` — environment-neutral optional-export, heap-buffer, batch/projection, live-input, and probe policy shared by the main-thread and Worker adapters.
  - `witnessEngine.ts` — isolated engine for the conformance-witness runner ([docs/specs/witnesses.md §2.3](docs/specs/witnesses.md)). Uses `wasmInterpreter.createIsolatedWasmModule()` — a non-memoised `createModule()` call that is never published to `__useqWasmRuntime` — and re-instantiates between witnesses (`useq_init` is idempotent and there is no `useq_clear` export, so a fresh module is the only clean reset). The live session's engine never evaluates witness code.
  - `wasmRuntimePort.ts` — adapter over `wasmInterpreter.ts` implementing the `WasmRuntimePort` contract. Surface is structured-cloneable / async / one-shot so it can become a worker postMessage boundary without re-shaping callers. Protocol-shaped operations (eval, transport commands) flow through `wasmJsonTransport.ts`; sampling-shaped operations stay direct.
  - `wasmJsonTransport.ts` — in-memory virtual transport that lets the WASM port speak the same `hello` / `stream-config` / `eval` / `ping` JSON protocol as hardware. Mirrors `transport/json-protocol.ts` at the message-shape level (no byte framing).
  - `wasmJsonHandlers.ts` — pure WASM-side request handlers for the JSON protocol. Dispatches `hello` / `ping` / `stream-config` / `eval` against an injected `WasmJsonBackend`.
  - `wasmRuntimeWorkerPort.ts` — default `WasmRuntimePort` in browsers with Web Worker support; proxies every method to a dedicated classic Worker hosting the WASM interpreter. The in-process port is the fallback when Workers are unavailable or fail to construct. Diagnostics readback is piped through worker request/response messages.
  - `activeWasmRuntimePort.ts` — read-through accessor returning the active `WasmRuntimePort` (worker-backed by default, in-process fallback). Bootstrap is the only writer.
  - `activeSynthesisService.ts` — same accessor pattern for the synthesis engine service; bootstrap is the only writer.
  - `browserEvalSurface.ts` — devmode `window.__useqBrowserEval` surface: verified eval route + `sampleOutputAtTime` + deterministic clock hooks (`freezeClock`/`stepClock`/`resumeClock`/`isClockFrozen`) over the visualisationRuntime time-source seam; used by the first-sound listening guide ([docs/synthesis/LISTENING_GUIDE.md](docs/synthesis/LISTENING_GUIDE.md)) and the e2e journeys.
  - `workers/wasmRuntime.worker.ts` + `workers/wasmRuntimeWorkerProtocol.ts` — classic Web Worker hosting the WASM interpreter and the discriminated-union request/response protocol it speaks; Worker loading, audio production, and dispatch stay local while interpreter policy comes from `wasmInterpreterCore.ts`.
  - `runtimeDiagnostics.ts` — startup/environment diagnostics surface.
  - `startupContext.ts` — URL flag parsing and bootstrap context (incorporates the former `urlParams.ts`).
  - `applyKeymapFromUrl.ts` — decodes the `?keymap=<base64>` URL profile at boot and merges it into `settings.keybindings` ([docs/specs/url-params.md §2.3](docs/specs/url-params.md), [docs/specs/keybindings.md §1.13](docs/specs/keybindings.md)).
  - `configManager.ts` + `default-config.json` — internal dev tooling for config import/export (paired with `scripts/config-server.mjs`).
  - `jsonProtocol.ts` — lightweight in-runtime helpers (distinct from `transport/json-protocol.ts`).
- `src/effects/` — composable side-effect modules. Framework-agnostic where possible.
  - `transportOrchestrator.ts`, `transportClock.ts` — XState-driven transport state and clock policy.
  - `localClock.ts` — thin API shim over `visualisationRuntime.ts` (internal clock when no hardware).
  - `visualisationRuntime.ts` — single rAF loop owning render + sampling + local time; all ModuLisp local-time reads go through one injectable time source (`setVisualisationNowSource`, default `performance.now`) — the deterministic clock seam for e2e.
  - `editor.ts`, `editorEvaluation.ts` — editor-side eval orchestration (eslint exception: imports editors).
  - `noneModeGate.ts` — `none`-mode eval gate (rejects eval with the §1.10 "no runtime available" warning) ([docs/specs/runtime-modes.md §1.10](docs/specs/runtime-modes.md)).
  - `standaloneDiagnosticsRouter.ts` — routes unsolicited device→editor `diagnostics` frames (wire §5.9) from the typed channel through injected editor/diagnostic callbacks. Initialised once in `appLifecycle.createApp().start()`.
  - `visualisationSampler.ts` — WASM sampling with projection-fork architecture. Past buffer (`PastBuffer` rolling window, one sample/frame) + future buffer (batch-refilled on invalidation via save/restore, extended one sample/frame). Expression lifecycle (register/unregister/refresh), `tickAndProject()` entry point, `getRenderData()` for renderer consumption.
  - `adaptiveQuality.ts` — adaptive quality control for projection: skip thresholds, budget-aware future-edge push.
  - `hardwareBindingDispatcher.ts` — dispatches bound expressions on hardware button events. Subscribes to `hwInput` channel, scans editor doc for `(on-press|on-release|on-button|on-toggle)` forms, evals via WASM + hardware with per-binding FIFO queue and hold-tick coalescing ([docs/specs/hardware-bindings.md §4](docs/specs/hardware-bindings.md)). Editor-layer chip sync is injected via `DispatcherConfig` to respect import boundaries.
  - `liveEditStore.ts` — reactive live-edit slot store (current values, widget states, reconciliation).
  - `liveEditPersistence.ts` — live-edit persistence layer (debounced localStorage writes, orphan GC, reconciliation triggers per spec §7).
  - `midiInput.ts` — Web MIDI input enumeration and raw message parsing ([docs/specs/live-edit.md §5.6](docs/specs/live-edit.md)).
  - `midiLearnController.ts` — MIDI learn state machine (per-widget and batch-learn flows per spec §5.8).
  - `midiRouter.ts` — routes parsed MIDI CC/note messages to bound live-edit slots per spec §5.7.
  - `calibrationSequencer.ts` — CV 1V/oct calibration session state machine (wire-protocol-driven; manages begin/adjust/save-point/end lifecycle per [docs/specs/calibration.md](docs/specs/calibration.md)).
  - `driftDetector.ts` — per-output EMA drift scoring comparing hardware stream values against WASM tick values. Publishes `driftDetected` channel when aggregate exceeds threshold ([docs/specs/state-sync.md](docs/specs/state-sync.md)).
  - `stateSyncOrchestrator.ts` — subscribes to `driftDetected`, requests hardware state snapshot, applies to WASM. Manages cooldown, in-flight state, console feedback ([docs/specs/state-sync.md](docs/specs/state-sync.md)).
  - `hardwareConnectPrompt.ts` — on a `wasm` → `both` transition (fresh hardware connect), prompts "send current program to device?" and sends the editor program on confirm ([docs/specs/runtime-modes.md §1.7](docs/specs/runtime-modes.md)).
  - `engineAutoplayListener.ts` — global any-interaction autoplay resume for the synthesis engine (capture-phase, trusted-events-only; [docs/specs/synthesis.md §6.5](docs/specs/synthesis.md)).
  - `mockControlInputs.ts`, `perfBenchmark.ts` (DEV-only — `window.__useqBench.run(channelCount)` exercises the vis pipeline at scale).
- `src/editors/` — CodeMirror layer. Imports lib/contracts/effects/transport.
  - `extensions.ts` — extension barrel.
  - `extensions/structure/` — structural-editing core. `core/` holds the pure functional tree/cursor logic: `types.ts` (Tree, Node, Cursor, CursorSet, State, OpResult data shapes), `nav.ts` (pure navigation ops), `mutate.ts` (pure mutation ops via `makeMutators(cfg)`), `clipboard.ts` (structural kill-ring: cut/copy/paste/paste-before/duplicate per spec §8.4), `holes.ts` (hole creation, recognition, traversal), `traversal.ts` (tree traversal helpers, `findById`), `meta.ts` (Meta stack operations: add/remove/cycle/foldToggle per spec §6.6), `docOps.ts` (document-root bulk operations: deleteAll/selectAll per spec §5.3), `index.ts` (public re-exports). No CodeMirror dependency. `adapter/` holds the CodeMirror binding: `stateField.ts`, `nodeOverlays.ts` (SVG overlay for cursor halos, indent guides, node polygons), `holeWidget.ts` (hole pill widgets), `dispatcher.ts` (op dispatch — supports `nav.up`/`nav.down`/`nav.left`/`nav.right` plus tree-walk variants and `format.topLevel`/`format.document`/`format.indentToFixedPoint` reformat commands), `treeFromLezer.ts`, `spatialNav.ts` (vertical spatial nav using source positions), `spatialMove.ts` (spatial `move_up`/`move_down` line relocation; `move_left`/`move_right` reuse sibling transpose), `applyOp.ts` (structural op application, picks printer + optional post-pass via `format.autoFormatStrategy`, preserves inter-top-level whitespace via `buildDocWithPreservedGaps`), `cursorFromSelection.ts`, `cursorPath.ts`, `extension.ts`, `printTree.ts` (flat `printNode`, line-breaking `printNodeWithBreaks`, formatting-aware `formatNode` per [docs/specs/formatting.md](docs/specs/formatting.md)), `indentFixedPoint.ts` (iterates CodeMirror `indentRange` to a fixed point — the "press Tab N times" auto-indent). Spatial-nav ActionIds (`nav.up`/`nav.down`/`nav.left`/`nav.right`) reach the dispatcher via the keybindings handler registry — there is no separate gamepad bridge. Both layers have `__tests__/` dirs.
  - `extensions/expressionHighlights.ts`, `expressionEval.ts`, `expressionEvalState.ts`, `expressionEvalDefaults.ts` — code-evaluation feedback (gutter pills, play-button DOM, last-evaluated tracking, Lezer-driven expression-bounds detection).
  - `extensions/lezerHelpers.ts` — Lezer/AST helpers (`findNodeAt`, `getTrimmedRange`, `getContainerNodeAt`, `isStructuralToken`, `isContainerNode`, `isOperatorNode`) used by callers outside the structural-editing core.
  - `extensions/probes.ts`, `probeHelpers.ts` — inline probe widgets (DI-configured).
  - `extensions/inlineResults.ts` — inline eval result display (DI-configured).
  - `extensions/diagnostics.ts` — error/warning squiggles wired to WASM diagnostics.
  - `extensions/evalHighlight.ts`, `extensions/visReadability.ts`.
  - `extensions/liveEdit/` — live-edit editor layer. `widgets.ts` (inline knob/slider/toggle/picker per spec §4), `vectorMarking.ts` (solid/dotted underlines for vector-mark sub-mode per spec §3.7), `markAction.ts` (mark/unmark/commit/reset/rename/editRange + multi-cursor + insertion-mode per spec §3/§6), `rangeInference.ts` (`:min`/`:max` auto-inference per spec §3.4), `vectorMarkController.ts` (vector-mark sub-mode state machine per spec §3.7), `widgetStoreBridge.ts` (connects live-edit store to CodeMirror widgets), `pasteHandler.ts` (duplicate `:id` rewriting on paste per spec §3.9), `idleEval.ts` (auto-eval after structural changes per spec §6.6). Tests in `__tests__/`.
  - `extensions/hardwareBinding/chipWidget.ts` — inline chips for `(on-press|on-release|on-button|on-toggle :sw1 …)` wrappers, with status dot, lifecycle indicator, fired-pulse and error states ([docs/specs/hardware-bindings.md §3](docs/specs/hardware-bindings.md)).
  - `keymaps.ts`, `editorKeyboard.ts`, `gamepadNavigation.ts`, `themes.ts`.
- `src/ui/` — Solid components. Leaf layer; can import from anywhere.
  - `MainToolbar.tsx`, `TransportToolbar.tsx` — top-level toolbars (props-based, with Wired wrappers in `adapters/`).
  - `Modal.tsx`, `ProgressBar.tsx`, `Tabs.tsx`, `OnboardingBanner.tsx`, `VisLegend.tsx`. (The legacy `InternalVis.tsx` Canvas2D renderer + its `WiredInternalVis` adapter were deleted — the live renderer is the WebGL `serialVisGL.ts`.)
  - `menu/` — `RadialMenu.tsx` (double-ring radial menu rendering, segment layout, verb indicators), `CenterPanel.tsx` (centre status/preview display), `menu.css` (ring and segment styling).
  - `mainMenu/` — `MainMenu.tsx` (vertical list main menu overlay), `menuItems.ts` (static menu item definitions), `mainMenu.css`. Adapter: `adapters/mainMenu.tsx`.
  - `overlayManager.ts`.
  - `adapters/` — imperative mount bridges via `createSolidAdapter()` (toolbars, panels, modal, picker-menu, double-radial-menu, snippets, settings, visualisation, palette, modifier-hints, visualisation-panel, `mainMenu.tsx` for the main menu overlay, `liveEditPanel.tsx` for the dockable live-edit panel, `calibration.tsx` for the full-screen calibration takeover); `engineIndicatorRecovery.ts` owns the tested recover-then-resume callback.
  - `settings/` — settings panel + per-section components (General/Editor/Theme/Visualisation/Storage/Personal/Console/UI/EvalResults/Advanced/ConfigurationManagement/Midi). Built on `FormControls.tsx`. `devmodeContext.ts` gates `level="advanced"` rows/sections behind `?devmode=true`. `MidiSettings.tsx` covers Web MIDI input enumeration + permission flow ([docs/specs/live-edit.md §5.6](docs/specs/live-edit.md)).
  - `liveEdit/` — dockable live-edit panel (`LiveEditPanel.tsx`, `LiveEditCard.tsx`) + MIDI learn UX pieces (`MidiLearnAffordance.tsx`, `MidiLearnBanner.tsx`, `MidiLearnConflict.tsx`). Pure prop-driven; the runtime-binding flow (gii8.43 follow-up) wires actual MIDI event subscriptions.
  - `calibration/` — full-screen CV 1V/oct calibration takeover (`CalibrationTakeover.tsx`, `CalibrationPicker.tsx`, `CalibrationSlider.tsx`, `CalibrationProgress.tsx`, `CalibrationCompleteBanner.tsx`) per [docs/specs/calibration.md](docs/specs/calibration.md). UI shell only; the wire-protocol-driven session state machine is gii8.60.
  - `help/` — help panel, ModuLisp reference tab, code snippets, keybindings tab, snippet modal, `helpChannels.ts`, `guideNavigation.ts` (opens the help panel at a guide section; bridges `contracts/guideChannels.ts`). Sub-dirs: `guide/` (chapter-based user guide, live probes, playground; `chapters/ch0-machine.ts` is the opening "How uSEQ Thinks" chapter, [docs/specs/the-machine.md](docs/specs/the-machine.md) §3), `machine/` (below), `lessons/` (`MiniVis.tsx`), `ledger/` (below).
  - `help/machine/` — **The Machine**: the user-facing live schematic of how uSEQ thinks ([docs/specs/the-machine.md](docs/specs/the-machine.md)). `machineModel.ts` (pure — the six ideas, region layout, row/spark derivations), `machineEvents.ts` (subscriptions wiring the real transport actor, `codeEvaluated`, `outputHealthStore`, `visualisationStore` and the sampler's past buffers), `MachinePanel.tsx` (`MachinePanel` pure view + `WiredMachinePanel`). Mounted in two places: the chapter-0 `intro` block via the `machine` content block, and the standalone `machine` chrome panel (`adapters/panels.tsx`, `toggleMachinePanel()`). **Honesty rule (spec §1.2): no timer, no rAF, no interpolation — every visual change is a real app event, and a missing runtime renders quiescent.**
  - `help/ledger/` — **Engine Ledger**, devmode-only — spec: [docs/specs/engine-ledger.md](docs/specs/engine-ledger.md): `LedgerTab.tsx` spec index + document view, `SpecDocument.tsx` rendered spec markdown with `N.N` clause anchors and read-only code fences, `ClauseBadge.tsx` per-clause verdict chip, `WitnessDetail.tsx` steps/expected-vs-actual, `ledgerStore.ts` session-scoped run state — never persisted. The Ledger tab is appended to `HelpPanel` only when `isDevmode()`; devmode off leaves no trace of it.
  - `keybindings/` — `KeybindingsPanel.tsx`, `KeyboardVisualiser.tsx`, `ActionPalette.tsx`, `ModifierHints.tsx`.
  - `console/` — `ConsolePanel.tsx` REPL/log panel + CSS.
  - `panel-chrome/` — drawer/pane/tile chrome primitives + CSS.
  - `visualisation/` — `serialVisGL.ts` (WebGL2 renderer: projection-fork pipeline, faithful-past / projected-future, frontier tracking, per-output VBOs, output classification, adaptive quality), `webglLineRenderer.ts` (low-level WebGL line drawing). Pure entry `drawSerialVisGL(input)` for harnesses; wired entry `drawSerialVisGLFromStores()` for production. Render hooks register via `adapters/visualisationPanel.ts`. Sampling/state live in `effects/visualisationSampler.ts` and `utils/visualisationStore.ts`.
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
- `src/machines/` — XState machines. `transport.machine.ts` (transport state).
- `src/types/` — ambient declarations (`web-serial.d.ts`, `clojure-mode.d.ts`).
- `src/build/` — build-time tests (`single-bundler.test.ts`).

## Key files

- `src/main.ts` — Vite entrypoint; imports CSS, calls `bootstrap()`.
- `src/runtime/bootstrap.ts` — startup orchestration; only place wiring runtime → UI/editors.
- `src/contracts/wasmAbi.ts` — single source of truth for WASM exports the editor consumes.
- `src/contracts/useqRuntimeContract.ts` — shared transport command floor.
- `vite.config.ts` — single bundle from `src/main.ts` to `public/solid-dist/`; defines Vitest `unit` + `storybook` projects.
- `eslint.config.js` — import-boundary zones with documented per-file exceptions.
- `tsconfig.json` — strict check of all production `.ts`/`.tsx` under `src/`; tests and stories are excluded, and `@ts-nocheck` is not permitted.
- `scripts/build-assets.mjs` — copies markdown/reference/WASM/fonts into `public/`, verifies the compiler record and exact served bytes, generates the application served-bundle record, and runs the two Engine Ledger harvests below. Watch mode observes all of these source domains.
- `scripts/harvest-witnesses.mjs` — parses `src-useq/test/conformance/**/*.yaml` into `public/assets/witness-index.json`, including the per-spec-file clause→witness aggregation ([docs/specs/witnesses.md §3](docs/specs/witnesses.md)). Parse errors, duplicate case names and malformed `spec:` refs fail the build; a missing `spec:` warns. Standalone: `npm run harvest:witnesses`.
- `scripts/harvest-specs.mjs` — copies `src-useq/docs/specs/*.md` into `public/assets/spec-corpus.json`, pre-tokenised into a block model with `N.N` clause anchors, raw code fences, and intra-corpus links rewritten for in-Ledger navigation. Index order mirrors the corpus `MAIN.md` §6. Standalone: `npm run harvest:specs`.
- `scripts/compiler-capability-manifest.mjs` + `scripts/served-bundle-manifest.mjs` — verify the compiler profile and emit/reverify one deterministic, explicitly unsigned application-profile record over app source identity, the compiler record/interpreter, module-owned NodeDef descriptor/bytes and sample-rate/render-quantum contract, activation domain, and synthesis worklet. Compiler, application, and target-build fields have explicit profile ownership.
- `scripts/config-server.mjs` — local dev config-write endpoint (paired with `runtime/configManager.ts`).
- `scripts/dev/` — native-bridge dev tooling: `useq-stub-ws-server.mjs` (loopback WS stub speaking the JSON `hello` protocol, run via `dev:stub-ws`) and `verify-ws-serialport.mjs` (bridge smoke check, run via `verify:native-bridge`).
- `package.json` — see scripts: `dev`, `build`, `build:assets`, `build:wasm`, `harvest:witnesses`, `harvest:specs`, `test:mocha`, `test:unit`, `test:all`, `test:e2e`, `test:browser-local-eval`, `test:release`, `lint`, `typecheck`, `storybook`, `inspector`, `inspector:validate`, `src-useq:status`.

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
- [docs/design/firmware-compatibility-and-beta-release.md](docs/design/firmware-compatibility-and-beta-release.md) — old/new firmware differences, compatibility boundary, beta channel, and production cutover runbook.
- [src-useq/docs/specs/wire-protocol.md](src-useq/docs/specs/wire-protocol.md) — serial framing, JSON message shapes.
- [docs/specs/reactive-flow.md](docs/specs/reactive-flow.md) — stores, channels, signals, data flow paths.
- [docs/specs/keybindings.md](docs/specs/keybindings.md) — unified keybinding architecture.
- [docs/specs/inspector.md](docs/specs/inspector.md) — Inspector design.
- [docs/specs/user-guide.md](docs/specs/user-guide.md) — in-app user guide design.
- [docs/specs/live-edit.md](docs/specs/live-edit.md) — live-edit wrapper forms, inline widgets, panel, MIDI learn, persistence.
- [docs/specs/state-identity.md](docs/specs/state-identity.md) — hidden/editor-generated IDs for anonymous stateful expressions, linked output variants, duplicate-active validation, and runtime state-resource schemas.
- [src-useq/docs/specs/state-identity.md](src-useq/docs/specs/state-identity.md) — runtime/language counterpart for state-resource IDs, cold-eval signal expression results, duplicate-active ID diagnostics, and projection semantics.
- [docs/specs/hardware-bindings.md](docs/specs/hardware-bindings.md) — hardware button/toggle binding wrapper forms, inline chip widgets, test-fire UX.
- [docs/specs/calibration.md](docs/specs/calibration.md) — CV 1V/oct calibration full-screen takeover flow.
- [docs/specs/structural-editing.md](docs/specs/structural-editing.md) — focus-primary ontology, Metas, holes, nav/mutate algebra.
- [docs/specs/structural-fuzzing.md](docs/specs/structural-fuzzing.md) — deterministic fuzz harness for structural command dispatch, cursor/range invariants, and parser-recovery safety.
- [docs/specs/input-dispatch.md](docs/specs/input-dispatch.md) — command router as single chokepoint for editor-directed intents.
- [docs/specs/radial-menu.md](docs/specs/radial-menu.md) — gamepad-driven double-ring command surface (verbs, auto-chain, manifest/templates).
- [docs/specs/main-menu.md](docs/specs/main-menu.md) — system/pause menu (L3+R3 chord), gamepad-navigable overlay for settings/help/connection.
- [docs/specs/formatting.md](docs/specs/formatting.md) — auto-formatting policy: when, what "well-formatted" means, width/complexity thresholds, user-layout preservation.
- [docs/specs/zen-mode.md](docs/specs/zen-mode.md) — distraction-free structural editing practice environment.
- [docs/specs/gamepad-handoff.md](docs/specs/gamepad-handoff.md) — gamepad pipeline rebuild status (working document).
- [docs/BEADS_BACKEND.md](docs/BEADS_BACKEND.md) — **archival** Beads/Dolt backend setup (frozen historical infrastructure; use `ergo` instead).
- [docs/adr/](docs/adr/) — architectural decisions (`0001` runtime surfaces, `0002` config-manager scope, `0003` archive boundaries).
- [docs/design/synthesis-epic.md](docs/design/synthesis-epic.md) — synthesis engine roadmap + v1 epic; [docs/design/adr/](docs/design/adr/) holds the 8 synthesis ADRs (ADR-0003 carries the recorded Atomics.wait pacing deviation).
- [docs/specs/synthesis.md](docs/specs/synthesis.md) — app-side synthesis engine contract; language-side counterpart [src-useq/docs/specs/synth-nodes.md](src-useq/docs/specs/synth-nodes.md).
- [docs/synthesis/LISTENING_GUIDE.md](docs/synthesis/LISTENING_GUIDE.md) — user-run first-sound manual validation procedure (audibility is not automated; this guide is the residual manual surface).
- [src-useq/docs/specs/diagnostics.md](src-useq/docs/specs/diagnostics.md) — diagnostic data shapes and ABI; see [src-useq/docs/specs/failure-model.md](src-useq/docs/specs/failure-model.md) for failure semantics.
- [inspector/CLAUDE.md](inspector/CLAUDE.md) — Inspector agent guide.

## Local gotchas

- `src-useq/` and `deps/modulisp/` are git submodules; commits there go through their own repos. Run `npm run src-useq:status` to see the pinned commit.
- Browser compiler artefacts (`public/wasm/useq.{js,wasm}` plus `useq-capabilities.json`) are generated from the pinned clean `src-useq/` by `npm run build:wasm`; `npm run build:assets` verifies the compiler manifest against both source and served bytes, then generates `public/wasm/useq-served-bundle.json` over the app source identity, those files, `osc_sine.wasm` + its module-emitted descriptor/clock contract, and `synthesisWorklet.js`. The records are deterministic but unsigned; each names its profile-owned and not-applicable fields.
- `appSettingsRepository` (canonical) and `settingsStore` (reactive Solid mirror) are separate. UI reads the store; mutations go through `runtimeService`.
- `serialBuffers` in `transport/stream-parser.ts` are imperative `CircularBuffer`s, not part of the Solid store.
- `?nosave` URL param fully bypasses persistence; useful in tests.
- Dev mode (`npm run dev`) injects `data-component` attrs; production builds strip them.
- `src/runtime/jsonProtocol.ts` and `src/transport/json-protocol.ts` are different files — the transport one is the wire driver, the runtime one is in-runtime helpers.
- `src/lib/appSettings.ts` is the sanctioned settings barrel; schema/normalisation/persistence live under `src/lib/settings/` (internal split — import via the barrel).
- `scripts/documentation/` is archival (pre-current pipelines); ignored by ESLint and not part of the live build.
- Durable task tracking uses `ergo` (the coding-work CLI over the Holon EAV substrate). Beads (`bd`) and Dolt are frozen read-only historical infrastructure; `docs/BEADS_BACKEND.md` is retained only as archival reference.

## Specs

- **Root**: `docs/specs/`
- **Entry**: `MAIN.md`
- **Layout**: `flat` (frontmatter-tiered; promote to two-layer per-concern only when a real second impl emerges)
- **Index**: `docs/specs/.index.json` (auto-generated, git-tracked; regenerate via `/specs regenerate-index`)
- **Skill**: invoke `/specs` to review/maintain/add/navigate. The skill auto-suggests relevant §s when a coding task touches spec-cited files.

### Roots (multi-tree)

```yaml
roots:
  - path: docs/specs
    role: app-behaviour
  - path: src-useq/docs/specs
    role: language-semantics
    counterparts: true   # files of same name pair across roots (MAIN.md, state-identity.md, …)
```

### Local conventions

- MAIN.md uses three-level sub-indexing (`§6.13.1`, `§7.10.1`) — fine; the navigator recognises both `§N.M` and `§N.M.K`.
- Two files are explicitly **non-normative** working documents (carry `non-normative: true` in frontmatter): `gamepad-handoff.md`, `gamepad-browser-test.md`. Reviewer should propose moving them to `_drafts/` next time the corpus is touched.
- `src-useq/` is a git submodule; spec changes there require a separate commit in the submodule.

### Exclusions

- `_archive/` (always)
- `_reviews/` (always)
- `_drafts/` (always)

### Lint policy

```yaml
validators: [reference-integrity, frontmatter-integrity, layer-stability-consistency]
# spec-touched-when-behaviour-touched requires a git hook wiring; not enabled by default
```

### How to use specs in this project

Before changing behaviour, find the relevant spec via `/specs navigate <task>` or directly read MAIN.md's keyword table in `CLAUDE.md`. The spec wins over implementation by intent — if the spec is wrong, update it in the same commit as the code change. New cross-cutting concerns (failure model, perf, stable surface) go in MAIN.md; per-feature concerns in their own sub-spec.

## Strategic concerns

See `ALIGNMENT.md` for opinionated diagnosis of gaps and defects.
