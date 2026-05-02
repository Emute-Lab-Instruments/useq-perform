# Architectural Smell Audit — useq-perform

**Date**: 2026-05-02  
**Tool**: Factory Droid (read-only mission)  
**Branch**: `v1.2.0`  
**src-useq pin**: `7f3a8879` on `feature/bytecode-vm-core` (clean, not dirty)

---

## 1. Executive Summary

### Findings by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| A1 Architectural blocker | 1 | A smell materially preventing reasoning about a stable-core workflow |
| A2 High-leverage cleanup | 10 | Real drift risk, testability barriers, or cross-subsystem complexity |
| A3 Medium cleanup | 22 | Localized design issues with clear small-to-medium fixes |
| A4 Low cleanup | 13 | Minor duplication, naming, layering, or shape issues |
| A5 Observation / investigate | 5 | Suspicious patterns that may be fine |
| **Total** | **51** | |

### Top 5 Highest-Leverage Cleanups

1. **Consolidate `UseqDiagnostic` into `contracts/runtimeTypes.ts`** (A2). Eliminates boundary violations in `contracts/` and `transport/`, removes a duplicated type, and unblocks adding a `transport → runtime` ESLint boundary rule.

2. **Extract WASM binding logic from worker** (A2). ~300 lines of subtle ABI-binding + fallback logic are duplicated between `wasmInterpreter.ts` and `wasmRuntime.worker.ts`. Any fix to the fallback chain must be applied twice.

3. **Add `transport → runtime` ESLint boundary rule** (A2). Currently the transport layer freely imports from runtime (protocol types, app settings, startup flags), inverting the intended layering. A single lint rule would prevent further drift.

4. **Remove module-level side effects in `visualisationSampler.ts`** (A2). A `setTimeout(0)` at module scope subscribes to channels with a TDZ catch — tests importing this module get invisible subscriptions, and the catch swallows real errors.

5. **Apply DI pattern to `eval-integration.ts` and `gamepadNavigation.ts`** (A2). These editor extensions reach directly into the transport layer (`sendTouSEQ`, `isConnectedToModule`, `sendSerialInputStreamValue`), preventing Inspector/test isolation. The DI pattern already exists for probes, inline results, and gutter.

### Commands Run

| Command | Result |
|---------|--------|
| `npm run src-useq:status` | Pin `7f3a8879`, branch `feature/bytecode-vm-core`, clean |
| `npm run typecheck` | 12 errors in `configManager.ts`, `connector.ts`, `RadialMenu.tsx`, `TestComponent.tsx`, `GuideTab.tsx`, `ThemeSettings.tsx` |
| `npm run lint` | Clean (zero errors) |
| Targeted `rg` searches | ~40 searches across all smell categories |

### Areas Inspected

Every file in `src/runtime/`, `src/transport/`, `src/effects/`, `src/editors/`, `src/ui/`, `src/utils/`, `src/lib/`, `src/contracts/`, `src/machines/`. Selective inspection of `src/zen/`. Orientation docs: `README.md`, `MAP.md`, `ALIGNMENT.md`, `STABLE_CORE.md`, `RUNTIME_CONTRACT.md`, `REACTIVE_FLOW.md`, `docs/specs/MAIN.md`, `src-useq/README.md`, `src-useq/docs/specs/MAIN.md`.

---

## 2. Current Architecture Sketch

### Where the Shape Is Already Good

- **Typed channels** for all inter-module communication. No `CustomEvent` dispatching in product code (legacy events fully removed). Channel definitions are concentrated in `src/contracts/`.
- **DI pattern for CodeMirror extensions** (`ProbeConfig`, `InlineResultsConfig`, `GutterConfig`). Extensions render in the Inspector dev tool in isolation.
- **Props-based UI components** for toolbars, modal, help panel, keyboard visualiser. Adapters wire real stores into props.
- **WASM ABI contract** (`src/contracts/wasmAbi.ts`) with `assertWasmAbi()` validation at instantiation time. Runtime-probed optional exports with graceful fallback.
- **Settings mutation surface** is centralized through `runtimeService` → `appSettingsRepository` → `settingsChanged` channel → `settingsStore`. Single-writer, multi-reader.
- **Import boundary rules** (ESLint) enforce `lib/` and `contracts/` as leaf layers.
- **Port abstraction** (`runtimePorts.ts`) provides a unified interface for hardware and WASM, with structured-cloneable method signatures ready for worker postMessage.
- **XState transport machine** with clean state transitions and clock policy.
- **Spec-first discipline**: `docs/specs/MAIN.md` indexes 18 sub-specs. The spec wins over implementation.

### Where the Shape Is Most Strained

- **Boundary enforcement has gaps**: No `transport → runtime` ESLint rule; `contracts/` imports from `runtime/`; `lib/persistence.ts` imports from `runtime/startupContext.ts`.
- **Duplicate types**: `UseqDiagnostic` vs `RuntimeDiagnostic`, two `WasmRuntimePort` interfaces, two `devmodeSignal` signals, duplicated `parseTransportState` functions.
- **Module-level mutable singletons** without reset paths: `wasmInterpreter.ts` (4 `let` vars), `activeWasmRuntimePort.ts` (no test reset), `editorStore.ts` (10 `any`-typed lazy deps), `connector.ts` (`connectedToModule`), `json-protocol.ts` (`protocolState`).
- **Settings adapter pattern is vestigial**: `SettingsPanel.tsx` composes `GeneralSettings` directly (no adapter), so the `WiredGeneralSettings` in `adapters/settings.tsx` is dead code in production. All 8+ sub-panels silently fall back to global imports.
- **Legacy gamepad pipeline co-exists** with new three-stage pipeline (`gamepadManager.ts` + `gamepadIntents.ts` alongside `gamepad/` directory).
- **Editor evaluation** (`editorEvaluation.ts`) touches 8+ subsystems in a single function, mixing pure decision logic with IO dispatch.

---

## 3. Severity-Grouped Smell Catalog

### A1 Architectural Blocker

#### A1-1: `contracts/` imports `UseqDiagnostic` from `runtime/wasmInterpreter` — boundary inversion at the shared layer
- **Category**: Boundary
- **Status**: Confirmed
- **Files**: `src/contracts/runtimeChannels.ts:8`, `src/transport/types.ts:9`, `src/editors/extensions/diagnostics.ts:15`, `src/utils/outputHealthStore.ts:16`, `src/runtime/wasmInterpreter.ts:903`
- **Current shape**: `UseqDiagnostic` is defined in `wasmInterpreter.ts` (a runtime module) and imported by 5+ files in contracts, transport, editors, and utils. This makes the entire contracts layer depend on the WASM interpreter.
- **Why it matters**: `src/contracts/` is documented as a shared dependency-free layer that everything else can import. If it imports from `runtime/`, any consumer of contracts transitively couples to the WASM interpreter. This is the single highest-impact fix because it unblocks adding proper boundary rules.
- **Smallest useful fix**: Move `UseqDiagnostic` to `src/contracts/runtimeTypes.ts`. Update all 5+ import sites. This also resolves the `RuntimeDiagnostic` duplication (A2-2).
- **Validation**: `npm run lint` with a `contracts → runtime` boundary rule should pass. All diagnostic-related code compiles and tests pass.
- **Tracked in bd**: Not found.

---

### A2 High-Leverage Cleanups

#### A2-1: Duplicate WASM binding logic — ~300 lines mirrored between main thread and worker
- **Category**: Duplication/drift
- **Status**: Confirmed
- **Files**: `src/runtime/wasmInterpreter.ts` (lines ~180–500), `src/runtime/workers/wasmRuntime.worker.ts` (lines ~60–300)
- **Current shape**: Both files independently call `module.cwrap`, manage heap buffers, implement the same three-tier fallback (typed → legacy JSON → per-output sampling), and clone the diagnostic memoization pattern. The worker comment says "~50 lines of duplicated binding logic" — the actual count is ~300.
- **Why it matters**: The batch evaluator fallback chain is subtle. A fix to the fallback in one place that isn't replicated in the other becomes a behavioural divergence that only shows under specific WASM ABI configurations.
- **Smallest useful fix**: Extract the ABI-binding + batch-evaluator factory into a shared module importable by both contexts.
- **Validation**: Test that both paths return identical results for the same WASM module + inputs, specifically exercising each fallback tier.

#### A2-2: Two near-identical diagnostic types — `UseqDiagnostic` vs `RuntimeDiagnostic`
- **Category**: Type duplication
- **Status**: Confirmed
- **Files**: `src/runtime/wasmInterpreter.ts:903` (`UseqDiagnostic`), `src/contracts/runtimePorts.ts:271` (`RuntimeDiagnostic`)
- **Current shape**: Both define `{ start, end, severity, message, suggestion?, example? }` with the same field names and types. Some consumers use `UseqDiagnostic`, others use `RuntimeDiagnostic`.
- **Why it matters**: If a field is added to one but not the other, consumers silently diverge. This is the companion fix to A1-1 — once the canonical type lives in `contracts/`, the duplication resolves naturally.
- **Smallest useful fix**: Consolidate to a single type in `src/contracts/runtimeTypes.ts`. Re-export as aliases from both current locations during migration.
- **Validation**: `typecheck` + grep for remaining direct imports of the deprecated alias.

#### A2-3: No ESLint boundary rule for `transport → runtime`
- **Category**: Missing architectural guardrail
- **Status**: Confirmed
- **Files**: `eslint.config.js` (zones section), `src/transport/json-protocol.ts`, `src/transport/types.ts`
- **Current shape**: ESLint blocks `transport → ui` and `transport → editors`, but not `transport → runtime`. The transport layer imports from `runtime/jsonProtocol.ts` (message builders), `runtime/wasmInterpreter.ts` (diagnostic types), and `runtime/startupContext.ts` (flags).
- **Why it matters**: Without the guardrail, new `transport → runtime` imports can be added without any lint warning. The transport layer should be below runtime in the layering.
- **Smallest useful fix**: (1) Move shared protocol types to `contracts/` (A3-1). (2) Add a `zone(srcDir/transport/, srcDir/runtime/)` rule to `eslint.config.js`.
- **Validation**: `npm run lint` flags any `transport → runtime` imports after the rule is added.

#### A2-4: Module-level side effects in `visualisationSampler.ts` — deferred `setTimeout(0)` with TDZ catch
- **Category**: Reactive-flow / Control-flow
- **Status**: Confirmed
- **Files**: `src/effects/visualisationSampler.ts` (lines 679–706)
- **Current shape**: An `if (typeof window !== "undefined")` block at module scope uses `setTimeout(() => { ... loadAndApplySettings(); subscribeAppSettings(...) }, 0)` to defer initialization. The `catch { /* TDZ */ }` comment reveals the root cause: app settings may not be initialized yet when the module loads.
- **Why it matters**: Tests importing this module get invisible channel subscriptions. The TDZ catch silently swallows real initialization errors. Multiple imports in the same test process cause duplicate subscriptions.
- **Smallest useful fix**: Extract subscription setup into an explicit `initVisualisationSampler()` function called during bootstrap. Remove the module-level side effect.
- **Validation**: Import the module in a test without global setup and assert no subscriptions were created.

#### A2-5: `editorStore.ts` — mutable singleton with 10 `any`-typed lazy dependencies
- **Category**: State ownership
- **Status**: Confirmed
- **Files**: `src/lib/editorStore.ts` (lines 126–136, 158, 210)
- **Current shape**: 10 mutable module-level variables typed as `any`, populated by `resolveEditorDeps()` via dynamic `import()`. The `setupAutosaveTimer` and `createMainEditor` functions accept settings typed as `any`. No reset/dispose path for the autosave timer or settings subscription.
- **Why it matters**: The `any`-typed internals mean any refactoring of dependency modules silently compiles even if signatures change. The undisposed autosave interval leaks in test environments.
- **Smallest useful fix**: Replace the 10 `any`-typed variables with a single `EditorDeps` interface, typed concretely. Add a `_dispose()` function that clears the timer and unsubscribes.
- **Validation**: Test that `initEditorPanel` resolves deps, creates an editor, and that `disposeEditorPanel()` clears the autosave interval.

#### A2-6: Editor extensions reach directly into transport layer — `eval-integration.ts` and `gamepadNavigation.ts`
- **Category**: Boundary
- **Status**: Confirmed
- **Files**: `src/editors/extensions/structure/eval-integration.ts:10-11`, `src/editors/gamepadNavigation.ts:24`
- **Current shape**: `eval-integration.ts` imports `sendTouSEQ` from `transport/json-protocol.ts` and `isConnectedToModule` from `transport/connector.ts`. `gamepadNavigation.ts` imports `sendSerialInputStreamValue` from `transport/json-protocol.ts`. These extensions cannot be loaded without the full transport module.
- **Why it matters**: Inspector and test harnesses cannot load these extensions without transport dependencies. The DI pattern (used for probes, inline results, gutter) was designed for exactly this but wasn't applied here.
- **Smallest useful fix**: Create `EvalIntegrationConfig` and `GamepadNavConfig` interfaces with `sendCode`/`isConnected`/`sendInputStreamValue` getters, following the existing DI pattern.
- **Validation**: Render the extensions in isolation with a mock config — no transport imports needed.

#### A2-7: `bootstrap.ts` mixes pure logic, IO, and UI mounting in one file
- **Category**: Control-flow
- **Status**: Confirmed
- **Files**: `src/runtime/bootstrap.ts` (entire file, ~280 lines)
- **Current shape**: Contains: (1) pure decision logic (`resolveBootstrapPlan`), (2) environment detection, (3) settings loading, (4) WASM worker construction, (5) diagnostics publishing, (6) full UI mounting (8 adapters, editor creation, gamepad wiring). The `AppUI` interface has `mainEditor: any`.
- **Why it matters**: Any change to startup ordering, any new UI adapter, any new bootstrap step all touch this one file. The pure `resolveBootstrapPlan` is well-factored but buried.
- **Smallest useful fix**: Extract `createAppUI()` into `src/ui/adapters/appMount.ts`. Extract WASM worker construction into the port factory. Keep `bootstrap.ts` as a pure orchestrator.
- **Validation**: After extraction, `bootstrap.ts` has zero imports from `src/ui/adapters/` and zero DOM queries.

#### A2-8: Settings sub-panels bypass adapter pattern — direct global fallbacks
- **Category**: Boundary / Duplication
- **Status**: Confirmed
- **Files**: `src/ui/settings/GeneralSettings.tsx` (and 7 sibling sub-panels), `src/ui/settings/SettingsPanel.tsx`, `src/ui/adapters/settings.tsx`
- **Current shape**: Each sub-panel independently imports `globalSettings` and `requestSettingsUpdate` as defaults when props are omitted. `SettingsPanel.tsx` renders `GeneralSettings` directly (no adapter). The `WiredGeneralSettings` adapter exists but is never used in the production render path.
- **Why it matters**: The adapter layer is vestigial for settings — documented as a key pattern but not actually used. The global fallback imports are the real production path.
- **Smallest useful fix**: Make sub-panels require props (no global fallbacks). Have `SettingsPanel` compose through the adapter. Remove dead adapter code or make it the mandatory path.
- **Validation**: Rendering `GeneralSettings` without props throws or returns nothing.

#### A2-9: Legacy + new gamepad pipeline co-existence — two complete systems
- **Category**: Duplication / Simplicity
- **Status**: Confirmed
- **Files**: `src/lib/gamepadManager.ts` (594 lines), `src/lib/gamepadIntents.ts` (478 lines), `src/lib/gamepad/` (entire directory)
- **Current shape**: The old pipeline (`gamepadManager` + `gamepadIntents`) has its own polling, repeat, hold, and chord detection. The new pipeline (`gamepad/`) bridges to legacy channel-publishing code for unmigrated actions.
- **Why it matters**: Developers must understand both systems. The old files are dead code if the new pipeline is active, but can't be removed until the bridge in `createActionRunner` is complete.
- **Smallest useful fix**: Add deprecation comments to `gamepadIntents.ts`. Track remaining unmigrated actions. Once all actions are in the handler registry, remove `gamepadIntents.ts` entirely.
- **Validation**: `grep` for imports of `gamepadIntents.ts` — should only be bootstrap/wiring code.

#### A2-10: `transport/types.ts` imports from `runtime/wasmInterpreter` — boundary cross
- **Category**: Boundary
- **Status**: Confirmed
- **Files**: `src/transport/types.ts:9`
- **Current shape**: The transport types file imports `UseqDiagnostic` from the WASM interpreter. The ESLint config has no `transport → runtime` rule.
- **Why it matters**: Transport should not know about WASM. Resolved by A1-1 (move `UseqDiagnostic` to contracts).
- **Smallest useful fix**: Same as A1-1.
- **Validation**: Same as A1-1.

---

### A3 Medium Cleanups

#### A3-1: Protocol type duplication — `runtime/jsonProtocol.ts` vs `transport/json-protocol.ts`
- **Category**: Protocol definition duplication
- **Status**: Confirmed
- **Files**: `src/runtime/jsonProtocol.ts`, `src/transport/json-protocol.ts`, `src/transport/types.ts:8`
- **Current shape**: JSON protocol message builders live in `runtime/`. The wire driver in `transport/` imports them. `transport/types.ts` imports `IoConfig` from runtime. This creates `transport → runtime` dependencies.
- **Why it matters**: Wire protocol is a transport concern. Having runtime own protocol shapes means transport depends on a higher layer.
- **Smallest useful fix**: Move typed request/response interfaces and builders from `runtime/jsonProtocol.ts` to `src/contracts/jsonProtocol.ts`.
- **Validation**: `npm run lint` — no `transport → runtime` imports remain.

#### A3-2: `WasmRuntimePort` interface defined in two places
- **Category**: Protocol/contract
- **Status**: Confirmed
- **Files**: `src/contracts/runtimePorts.ts` (canonical), `src/runtime/wasmInterpreter.ts:460-510` (near-identical but different method names)
- **Current shape**: Two interfaces with the same purpose but different shapes (`eval` vs `evalCode`, missing `ensureLoaded`, etc.). The `wasmRuntimePort.ts` adapter bridges between them.
- **Why it matters**: "Which `WasmRuntimePort`?" ambiguity for anyone reading the code.
- **Smallest useful fix**: Remove the `WasmRuntimePort` interface from `wasmInterpreter.ts`. Rename the internal object to make it clear it's not the contract type.
- **Validation**: Grep for all imports of `WasmRuntimePort` — verify none resolve to `wasmInterpreter.ts`.

#### A3-3: Module-level mutable singletons in `wasmInterpreter.ts` — no test reset
- **Category**: State ownership
- **Status**: Confirmed
- **Files**: `src/runtime/wasmInterpreter.ts` (lines 1–20: `scriptLoadPromise`, `runtimePromise`, `lastKnownTimeWindowSupport`, `lastKnownTickAndProjectSupport`)
- **Current shape**: Four module-level `let` variables hold singleton state. No `resetWasmInterpreterForTests()` export.
- **Why it matters**: Tests that call `ensureUseqWasmLoaded()` mutate global state that isn't cleaned up.
- **Smallest useful fix**: Add a `resetWasmInterpreterForTests()` export. Encapsulate the four variables into a `WasmInterpreterState` object with explicit lifecycle.
- **Validation**: Test that re-instantiating the interpreter produces fresh state.

#### A3-4: No test reset for `activeWasmRuntimePort.ts`
- **Category**: Testing/proof
- **Status**: Confirmed
- **Files**: `src/runtime/activeWasmRuntimePort.ts`
- **Current shape**: Module-level `let activePort` defaults to in-process port. Bootstrap may set it to worker port. No reset function.
- **Why it matters**: Tests that run bootstrap change global state persisting across tests — a flaky test generator.
- **Smallest useful fix**: Add `resetActiveWasmRuntimePortForTests()`. Call it in test setup.
- **Validation**: Run test suite with `--shuffle` and check for WASM-port-related failures.

#### A3-5: Dual notification in `appSettingsRepository` — listeners + channel
- **Category**: State ownership
- **Status**: Confirmed
- **Files**: `src/runtime/appSettingsRepository.ts` (lines ~50–55)
- **Current shape**: Two notification mechanisms for the same event: a `Set<SettingsListener>` in the repository AND the `settingsChangedChannel` in the service layer.
- **Why it matters**: Two fire at different times. A consumer listening on both gets double-notified.
- **Smallest useful fix**: Remove the `listeners` Set. All consumers subscribe via `settingsChangedChannel`.
- **Validation**: Grep for `subscribeAppSettings` — verify consumers and migrate to channel.

#### A3-6: Circular-ish import: repository → runtimeService → runtimeSettingsService → repository
- **Category**: Module/dependency
- **Status**: Confirmed
- **Files**: `src/runtime/appSettingsRepository.ts`, `src/runtime/runtimeSettingsService.ts`, `src/runtime/runtimeService.ts`
- **Current shape**: `appSettingsRepository.ts` imports `updateRuntimeSettingsEffect` from `runtimeService.ts`. `runtimeSettingsService.ts` imports repository functions. `runtimeService.ts` re-exports both. Conceptual cycle broken only by barrel indirection.
- **Why it matters**: Reordering imports or changing the barrel can cause `undefined` at import time.
- **Smallest useful fix**: Remove `dispatchSettingsChanged()` from the repository. Have `runtimeSettingsService.ts` call `updateRuntimeSettingsEffect` after each mutation.
- **Validation**: Verify the repository has no upward dependency to the service layer.

#### A3-7: `runtimeSessionStore.ts` uses SolidJS in service-layer code
- **Category**: Reactive-flow
- **Status**: Confirmed
- **Files**: `src/runtime/runtimeSessionStore.ts`
- **Current shape**: Uses `createStore` + `reconcile` + `createEffect` + `createRoot` from SolidJS. This is service-layer code in `src/runtime/`.
- **Why it matters**: Can't be imported from a Web Worker or non-browser context without SolidJS. Makes unit testing require SolidJS.
- **Smallest useful fix**: Replace with a simple mutable object + `Set<Listener>`. Bridge to Solid reactivity at the adapter layer.
- **Validation**: Unit test that creates the store, subscribes, mutates — without SolidJS imports.

#### A3-8: `runtimeDiagnostics.ts` dual API — deprecated + canonical
- **Category**: Simplicity
- **Status**: Confirmed
- **Files**: `src/runtime/runtimeDiagnostics.ts`
- **Current shape**: `publishRuntimeDiagnostics()` is `@deprecated` but still used by all callers. The "canonical" `seedBootstrapDiagnostics()` + `publishDiagnosticsSnapshot()` API exists but isn't the primary path.
- **Why it matters**: The deprecated function conflates bootstrap seeding with state-change publishing.
- **Smallest useful fix**: Migrate all callers to the canonical API. Remove the deprecated shim.
- **Validation**: Grep for `publishRuntimeDiagnostics` — zero hits after migration.

#### A3-9: `appLifecycle.ts` renders raw HTML modals
- **Category**: Boundary
- **Status**: Confirmed
- **Files**: `src/runtime/appLifecycle.ts` (lines ~10–15, 60–75)
- **Current shape**: Constructs HTML strings and passes to `showModal()`. Runtime layer imports from UI adapters.
- **Why it matters**: Runtime should not construct UI. The modal content is untyped and invisible to component tests.
- **Smallest useful fix**: Move unsupported-browser modal to a UI component. Runtime sets a flag in session store.
- **Validation**: `appLifecycle.ts` has zero imports from `src/ui/adapters/`.

#### A3-10: `startupContext.ts` couples URL parsing + context state + environment detection
- **Category**: Module/dependency
- **Status**: Confirmed
- **Files**: `src/runtime/startupContext.ts`
- **Current shape**: Dynamic `import('../transport/connector.ts')` hides a circular dependency. URL parsing + flag application + context state management are three concerns in one file.
- **Why it matters**: The circular dep between `startupContext` and `connector` means they can't both load synchronously.
- **Smallest useful fix**: Split into `startupContext.ts` (state + freeze) and `startupFlags.ts` (URL parsing). Document the cycle explicitly.
- **Validation**: Verify that a static import from connector creates a circular dependency error.

#### A3-11: `__useqWasmRuntime` global accessed without type contract
- **Category**: Protocol/contract
- **Status**: Confirmed
- **Files**: `src/runtime/wasmRuntimePort.ts` (lines ~150–200)
- **Current shape**: Diagnostic readers access `globalThis.__useqWasmRuntime` via type assertion. No TypeScript declaration. Silent `[]` return on missing global.
- **Why it matters**: Silent failure hides diagnostics from users.
- **Smallest useful fix**: Add a `.d.ts` declaration. Log a warning when global is missing after WASM loads.
- **Validation**: Dev-mode check that `__useqWasmRuntime` exists after `ensureLoaded()`.

#### A3-12: `stream-parser.ts` imports from `effects/visualisationRuntime.ts` — backwards dep
- **Category**: Boundary
- **Status**: Confirmed
- **Files**: `src/transport/stream-parser.ts:11`
- **Current shape**: Transport calls `notifyExternalTimeUpdate()` directly. Transport → effects dependency.
- **Why it matters**: Can't test or reuse stream parser without dragging in the visualisation runtime.
- **Smallest useful fix**: Accept a callback `onTimeUpdate` in reader setup instead of importing the concrete module.
- **Validation**: `processAllMessages` with time-channel stream byte, callback receives the value.

#### A3-13: `protocolState` mutable singleton in `json-protocol.ts`
- **Category**: State ownership
- **Status**: Confirmed
- **Files**: `src/transport/json-protocol.ts` (lines 54–61), `src/transport/index.ts` (line 57)
- **Current shape**: Plain mutable object with no encapsulation, re-exported from barrel.
- **Why it matters**: Any consumer can `import { protocolState }` and mutate it directly.
- **Smallest useful fix**: Make state private. Expose only accessor functions. Remove barrel re-export.
- **Validation**: Barrel does not export the raw mutable object.

#### A3-14: `editorEvaluation.ts` couples 8+ subsystems in one function
- **Category**: Boundary / Control-flow
- **Status**: Confirmed
- **Files**: `src/effects/editorEvaluation.ts`
- **Current shape**: `evaluate()` imports from transport, WASM, diagnostics, output health, inline results, eval highlights, structure, manual control, startup context.
- **Why it matters**: Testing requires mocking all 8 subsystems. Pure decision logic (which region to eval, which strategy) is inseparable from IO.
- **Smallest useful fix**: Extract pure `selectEvalRegion(state, strategy)` → `{code, range, isImmediate}`. Side-effect dispatches in a separate orchestration function.
- **Validation**: Test `selectEvalRegion` without mocks for transport/WASM/diagnostics.

#### A3-15: `lib/persistence.ts` imports from runtime layer — boundary violation
- **Category**: Module/dependency
- **Status**: Confirmed
- **Files**: `src/lib/persistence.ts:12`
- **Current shape**: Imports `isLocalStorageBypassedInStartupContext` from `runtime/startupContext.ts`. Per architecture, `lib/` must not import from higher layers.
- **Why it matters**: This is a documented ESLint exception but still a real boundary violation.
- **Smallest useful fix**: Accept a `nosave` flag as a parameter instead of importing from runtime.
- **Validation**: `npm run lint` catches `lib → runtime` imports after removing the exception.

#### A3-16: Duplicate `parseTransportState` in two modules
- **Category**: Duplication/drift
- **Status**: Confirmed
- **Files**: `src/transport/webSerialHostPort.ts` (lines 40–51), `src/effects/transportOrchestrator.ts` (lines 37–48)
- **Current shape**: Identical functions that trim/strip quotes and switch on `"playing" | "paused" | "stopped"`.
- **Why it matters**: New transport state or wire format change requires updating both.
- **Smallest useful fix**: Extract to `src/transport/types.ts` and import from both consumers.
- **Validation**: Unit test the single shared function.

#### A3-17: Probe module uses module-level `_config` mutable — DI is only skin-deep
- **Category**: State ownership
- **Status**: Confirmed
- **Files**: `src/editors/extensions/probes.ts` (line 82, 1600, 1605)
- **Current shape**: `createProbeExtensions(config)` replaces a module-level `_config`. Two CodeMirror instances with different configs would silently conflict.
- **Why it matters**: Inspector dev tool could create a second editor with different probe config, breaking the main editor's probes.
- **Smallest useful fix**: Store config on the ViewPlugin instance (`this.config`) rather than module-level variable.
- **Validation**: Two editors with different probe configs, each uses its own config.

#### A3-18: Duplicate `devmodeSignal` in two modules
- **Category**: Duplicate reactive state
- **Status**: Confirmed
- **Files**: `src/ui/settings/devmodeContext.ts:23`, `src/ui/adapters/panels.tsx:175`
- **Current shape**: Two independent signals tracking devmode state. The `panels.tsx` one is hardcoded `false` with no way to toggle.
- **Why it matters**: `DesignSelector` in `panels.tsx` never shows devmode-only chrome because its signal is always `false`. Likely a bug.
- **Smallest useful fix**: Import `isDevmode` from `devmodeContext.ts` in `panels.tsx`. Remove local duplicate.
- **Validation**: `setDevmodeOverride(true)` → `DesignSelector` renders advanced options.

#### A3-19: `zen/progress.ts` bypasses persistence service — direct localStorage
- **Category**: Conventions violation
- **Status**: Confirmed
- **Files**: `src/zen/progress.ts:28,40,42`
- **Current shape**: Direct `localStorage.getItem` / `localStorage.setItem` calls.
- **Why it matters**: No `nosave` support, no JSON error recovery, no centralized key management.
- **Smallest useful fix**: Replace with `persistenceService.load()` / `persistenceService.save()`.
- **Validation**: `rg 'localStorage\.' src/ --type ts` returns zero hits outside `src/lib/persistence.ts` and tests.

#### A3-20: `referenceStore.ts` / `snippetStore.ts` — module-level `createEffect` persistence
- **Category**: Reactive-flow / Lifecycle
- **Status**: Confirmed
- **Files**: `src/utils/referenceStore.ts:43-59`, `src/utils/snippetStore.ts:87-91`
- **Current shape**: Three `createEffect()` calls at module scope auto-persist to localStorage. Run as soon as the module is imported.
- **Why it matters**: Importing these modules triggers side effects. Hard to control in tests.
- **Smallest useful fix**: Move persistence into explicit `save()` calls inside mutation functions.
- **Validation**: Import module in test without mocking localStorage — no writes until mutation.

#### A3-21: `gamepadMenuBridge.ts` — heavy editor manipulation in bridge code
- **Category**: Boundary / Testing
- **Status**: Confirmed
- **Files**: `src/ui/adapters/gamepadMenuBridge.ts` (lines 107–175)
- **Current shape**: ~70 lines of CodeMirror dispatch logic (replace, apply modes) in an adapter/bridge module.
- **Why it matters**: Editor manipulation is a separate concern from channel bridging. Hard to test and reuse.
- **Smallest useful fix**: Extract to a pure function in `src/editors/` (e.g., `applyPickerSelection(view, entry, mode)`).
- **Validation**: Test `applyPickerSelection` with mock `EditorView`.

#### A3-22: `useqRuntimeContract.ts` imports `TransportState` from `machines/`
- **Category**: Boundary
- **Status**: Confirmed
- **Files**: `src/contracts/useqRuntimeContract.ts:1`
- **Current shape**: Contracts import from machines — an upward dependency.
- **Why it matters**: The canonical type should live in contracts, with machines importing from contracts.
- **Smallest useful fix**: Move `TransportState` type to `src/contracts/runtimeTypes.ts`.
- **Validation**: Contracts has no imports from `machines/`.

---

### A4 Low Cleanups

#### A4-1: `runtimeService.ts` is a pure barrel obscuring service boundaries
- **Files**: `src/runtime/runtimeService.ts`
- **Category**: Module/dependency
- **Fix**: Add ESLint rule suggesting specific service file imports.

#### A4-2: `connector.ts` uses DOM manipulation for disconnect link
- **Files**: `src/transport/connector.ts:126-145`
- **Category**: Boundary
- **Fix**: Emit channel message; let UI render the interactive link.

#### A4-3: `currentVersion` in `upgradeCheck.ts` — mutable `let` export with no consumer
- **Files**: `src/transport/upgradeCheck.ts:29`
- **Category**: State ownership
- **Fix**: Return from `upgradeCheck()` or remove export if only used in tests.

#### A4-4: `serial-utils.ts` is a grab-bag with dead code
- **Files**: `src/transport/serial-utils.ts`
- **Category**: Module/dependency
- **Fix**: Split into focused modules. Remove unused smoothing/marker functions.

#### A4-5: `connector.ts` exposes `enterBootloaderMode` on `window` unconditionally
- **Files**: `src/transport/connector.ts:219-225`
- **Category**: Boundary
- **Fix**: Gate behind `import.meta.env.DEV`.

#### A4-6: Transport barrel re-exports mutable singletons
- **Files**: `src/transport/index.ts:58-64`
- **Category**: State ownership
- **Fix**: Only export accessor functions, not raw mutable objects.

#### A4-7: `consoleStore` `_maxConsoleLines` not in reactive store
- **Files**: `src/utils/consoleStore.ts:18-21`
- **Category**: Reactive-flow
- **Fix**: Move into `consoleStore` as proper field.

#### A4-8: `editorCompartments.ts` — dead autosave code
- **Files**: `src/lib/editorCompartments.ts:5-22`
- **Category**: Duplication/Simplicity
- **Fix**: Remove unused `stateExtensions` and `createUpdateListener`.

#### A4-9: `outputHealthStore.ts` — setTimeout fade without cleanup
- **Files**: `src/utils/outputHealthStore.ts:92-107`
- **Category**: Reactive-flow/Lifecycle
- **Fix**: Store timer handles in a Map, clear previous before setting new.

#### A4-10: `SerialVis.tsx` — continuous rAF loop without dirty check
- **Files**: `src/ui/SerialVis.tsx:194-202`
- **Category**: Simplicity/Perf
- **Fix**: Add dirty flag from reactive effect, only redraw when dirty.

#### A4-11: `ConsolePanel.tsx` — direct global store import
- **Files**: `src/ui/console/ConsolePanel.tsx:17-18`
- **Category**: Boundary
- **Fix**: Extract store reads into props via adapter (or document intentional decision).

#### A4-12: `internalVis.tsx` — polling-based change detection vs reactive tracking
- **Files**: `src/ui/InternalVis.tsx:95-101`
- **Category**: Reactive-flow
- **Fix**: Replace `setInterval(checkBufferChange, 100)` with `createEffect` tracking `visStore.serialBuffers.lengths`.

#### A4-13: `@ts-expect-error` for `@nextjournal/clojure-mode` — 7 sites
- **Files**: 7 files across editors, effects, zen
- **Category**: Type safety gap
- **Fix**: Create `src/types/clojure-mode.d.ts` with minimal type stubs.

---

### A5 Observations / Investigate

#### A5-1: `localClock.ts` is a pure pass-through to `visualisationRuntime.ts`
- **Files**: `src/effects/localClock.ts`
- **Category**: Simplicity
- **Note**: 67 lines of backward-compat aliases. Migration appears complete. Candidate for deletion.

#### A5-2: `TestComponent.tsx` — development artifact in production source
- **Files**: `src/ui/TestComponent.tsx`
- **Category**: Simplicity
- **Note**: Imports test infrastructure (`test.machine`, test effects). No production use. Move or delete.

#### A5-3: `perfTrace.ts` assigns `window.__useqPerf` at import
- **Files**: `src/lib/perfTrace.ts:139`
- **Category**: Module/dependency
- **Note**: Dev-only debugging hook at module evaluation. Minor global namespace concern.

#### A5-4: `runtimeSessionStore.ts` shallow snapshot — currently safe but fragile
- **Files**: `src/runtime/runtimeSessionStore.ts:30-40`
- **Category**: Reactive-flow
- **Note**: `snapshotState()` does one-level spread. Currently safe because `RuntimeSessionSnapshot` is flat. No type-level guarantee it stays flat.

#### A5-5: `runtimeTransportService.ts` polls all sources on every transport command
- **Files**: `src/runtime/runtimeTransportService.ts:20`
- **Category**: Reactive-flow
- **Note**: `activePortsForSharedCommands()` re-reads serial port capabilities, startup flags, and app settings on every dispatch. Correct but conceptually wasteful. Low priority.

---

## 4. Cross-Cutting Themes

### Repeated Sources of Complexity

1. **Duplicate types and protocol shapes.** At least 6 instances: `UseqDiagnostic` vs `RuntimeDiagnostic`, two `WasmRuntimePort` interfaces, two `devmodeSignal`s, `parseTransportState` in two files, protocol builders in `runtime/` while the wire driver is in `transport/`, `TransportState` imported from `machines/` into `contracts/`. Each duplication is individually small but collectively they make it unclear which definition is canonical.

2. **Module-level mutable singletons without lifecycle management.** `wasmInterpreter.ts` (4 `let` vars), `activeWasmRuntimePort.ts`, `editorStore.ts` (10 `any`-typed vars), `connector.ts` (`connectedToModule`), `json-protocol.ts` (`protocolState`), `visualisationUtils.ts` (palette), `outputHealthStore.ts` (timers). None have explicit reset/dispose paths. All are hard to test in isolation.

3. **Module-level side effects at import time.** `visualisationSampler.ts` (deferred subscriptions), `referenceStore.ts` / `snippetStore.ts` (persistence effects), `perfTrace.ts` (window mutation). Importing these modules in tests triggers invisible side effects.

4. **Settings adapter pattern is vestigial for sub-panels.** The adapter/props pattern is well-applied to toolbars, modal, and help panel. But all 8+ settings sub-panels fall back to globals, and `SettingsPanel.tsx` doesn't use the adapter at all. The adapter files exist but are dead code in production.

### Repeated Ownership Ambiguities

1. **Who owns diagnostic types?** Split between `wasmInterpreter.ts` and `runtimePorts.ts`. Consumers pick one arbitrarily.
2. **Who owns protocol message shapes?** Split between `runtime/jsonProtocol.ts` and `transport/json-protocol.ts`.
3. **Who owns `connectedToModule`?** It's a `let` in `connector.ts` with `setConnectedToModule()` and `isConnectedToModule()` exports, but the name suggests hardware connection while the actual semantics are "JSON handshake completed". The name is misleading per `STABLE_CORE.md`: "Any assumption that `connectedToModule` means 'real hardware is attached'" is explicitly called out as not a compatibility target.

### Repeated Testability Barriers

1. **Pure logic embedded in effectful code.** `editorEvaluation.ts` (eval region selection vs IO dispatch), `visualisationSampler.ts` (sampling logic vs channel subscriptions), `gamepadMenuBridge.ts` (editor dispatch vs channel bridging).
2. **No test seams for singletons.** WASM interpreter, active port, editor store, protocol state — all require mocking the module import system rather than injecting a test double.
3. **Import boundary exemptions.** 10 files have blanket ESLint boundary exemptions in `eslint.config.js`. Each represents a seam that can't be tested in isolation.

---

## 5. Suggested Execution Order

### Small First Fixes (1–2 hours each)

1. **Move `UseqDiagnostic` to `contracts/runtimeTypes.ts`** (resolves A1-1, A2-2, A2-10). This is the single highest-leverage fix.
2. **Extract `parseTransportState` to `src/transport/types.ts`** (A3-16). Trivial, eliminates drift risk.
3. **Consolidate duplicate `devmodeSignal`** (A3-18). Import canonical signal, remove duplicate.
4. **Add `resetWasmInterpreterForTests()` and `resetActiveWasmRuntimePortForTests()`** (A3-3, A3-4). Test quality improvement.
5. **Remove dead code**: `stateExtensions`/`createUpdateListener` in `editorCompartments.ts` (A4-8), `TestComponent.tsx` (A5-2).
6. **Gate `window.enterBootloaderMode` behind `import.meta.env.DEV`** (A4-5).
7. **Create `src/types/clojure-mode.d.ts`** — eliminate 7 `@ts-expect-error` suppressions (A4-13).

### Medium Follow-Ups (half-day each)

8. **Add `transport → runtime` ESLint boundary rule** (A2-3). Move protocol types to `contracts/` first (A3-1).
9. **Apply DI pattern to `eval-integration.ts` and `gamepadNavigation.ts`** (A2-6). Follow existing `ProbeConfig`/`InlineResultsConfig` pattern.
10. **Extract `initVisualisationSampler()`** — remove module-level side effects (A2-4).
11. **Move `TransportState` type to `contracts/runtimeTypes.ts`** (A3-22).
12. **Fix settings adapter**: make sub-panels require props, compose through adapter (A2-8).
13. **Migrate `runtimeDiagnostics.ts` callers to canonical API** (A3-8).
14. **Replace `runtimeSessionStore.ts` SolidJS usage with plain JS + listeners** (A3-7).
15. **Extract editor dispatch from `gamepadMenuBridge.ts`** (A3-21).
16. **Route `zen/progress.ts` through persistence service** (A3-19).
17. **Fix `internalVis.tsx` polling → reactive tracking** (A4-12).
18. **Fix `outputHealthStore.ts` timer cleanup** (A4-9).

### Larger Efforts (1–2 days each)

19. **Extract WASM binding factory from worker** (A2-1). Shared module for both main-thread and worker contexts.
20. **Decompose `bootstrap.ts`** (A2-7). Extract UI mounting and WASM worker construction.
21. **Decompose `editorEvaluation.ts`** (A3-14). Separate pure region selection from IO dispatch.
22. **Break `startupContext.ts` circular dependency** (A3-10). Split URL parsing from context state.
23. **Complete gamepad pipeline migration** (A2-9). Remove legacy `gamepadIntents.ts`.
24. **Remove `appSettingsRepository` dual notification** (A3-5, A3-6). Single channel, no listener set.
25. **Remove ESLint boundary exemptions** (track each as a `bd` issue).

### Things Not Worth Doing Yet

- **Renaming `connectedToModule`** — the name is misleading but the rename touches many files and tests. Better done during a focused transport refactor.
- **Full settings adapter refactor** — the current global-fallback pattern works. The adapter can become mandatory incrementally as sub-panels are touched for other reasons.
- **Removing `localClock.ts` pass-through** — safe but low priority. The aliases are harmless.
- **Full `console.warn`/`console.error` replacement** — routing through structured logging is good practice but not urgent.
- **SerialVis rAF dirty flag** — the continuous loop is wasteful but the WebGL renderer (`serialVisGL.ts`) already has visibility-based caching. Once WebGL becomes default, the canvas renderer matters less.

---

## 6. Appendix

### Command Summaries

```bash
npm run src-useq:status    # Pin 7f3a8879, feature/bytecode-vm-core, clean
npm run typecheck          # 12 errors (configManager, connector, RadialMenu, TestComponent, GuideTab, ThemeSettings)
npm run lint               # Clean (0 errors)
```

### Notable Searches

```
rg 'CustomEvent|dispatchEvent|addEventListener' src/ --type ts    # ~70 hits, all legitimate (DOM events, Web Serial, worker messages)
rg 'TODO|FIXME|HACK|XXX|legacy|deprecated' src/ --type ts        # ~80 hits, most are documentation/comments
rg 'window\.|globalThis' src/ --type ts                           # ~60 hits, concentrated in ui/, runtime/
rg 'as any' src/ --type ts                                        # ~50 hits, mostly in tests
rg 'localStorage\.' src/ --type ts                                # 3 hits outside lib/persistence.ts (zen/progress.ts, tests)
rg '@ts-expect-error|@ts-ignore' src/                             # 7 hits, all for @nextjournal/clojure-mode
rg 'import.*from.*wasmInterpreter' src/ --type ts                 # 8 hits, 5 for UseqDiagnostic type
rg 'import.*from.*runtimeService' src/ --type ts                  # 7 hits
rg 'import.*from.*transport/json-protocol' src/ --type ts         # 4 hits (2 in editors, 2 in runtime/effects)
rg 'import.*from.*transport/connector' src/ --type ts             # 2 hits in editors
rg 'connectedToModule' src/ --type ts                             # 7 hits, all in transport/connector.ts
```

### Files Reviewed

Every file in:
- `src/runtime/` (21 files + workers)
- `src/transport/` (8 files)
- `src/effects/` (7 files)
- `src/editors/` (15+ files including extensions)
- `src/ui/` (30+ files including adapters, settings, help, keybindings, console, visualisation)
- `src/utils/` (8 files)
- `src/lib/` (30+ files including settings, keybindings, gamepad, core infrastructure)
- `src/contracts/` (8 files)
- `src/machines/` (2 files)
- `src/zen/` (5+ files)

Orientation docs:
- `README.md`, `MAP.md`, `ALIGNMENT.md`, `CLAUDE.md`, `AGENTS.md`
- `docs/STABLE_CORE.md`, `docs/RUNTIME_CONTRACT.md`, `docs/REACTIVE_FLOW.md`, `docs/specs/MAIN.md`
- `src-useq/README.md`, `src-useq/docs/specs/MAIN.md`
- `eslint.config.js`, `vite.config.ts`, `tsconfig.json`, `package.json`

### Limitations of the Audit

1. **Read-only.** No code was executed. Typecheck errors and test results were captured but not investigated beyond surface analysis.
2. **No runtime profiling.** Performance smells are inferred from code structure, not measured. The visualisation rendering concerns (A4-10, A4-12) may be negligible in practice.
3. **No bd issue search.** The audit did not cross-reference findings against existing `bd` issues. Some findings may already be tracked.
4. **src-useq/ was audited only at the integration boundary.** WASM ABI alignment, protocol shapes, and copied artifacts were checked. A broad C++ architecture critique was explicitly out of scope.
5. **The `v1.2.0` branch has uncommitted changes** (gamepad, zen, tests). The audit focused on committed code; uncommitted changes were noted but not deeply analyzed.
6. **ALIGNMENT.md documents known debt.** Some findings overlap with known defects documented there (submodule pin lag, worker WASM diagnostics, probe sampler bypass). The audit treats these as independent confirmations rather than new discoveries.
