---
stability: stable
layer: cross-cutting
---

# Reactive Flow

> Spec: typed-channel invariants, mutation surfaces, import boundaries, and channel/store inventory. Counterpart to [MAIN.md](MAIN.md).

### Source files

- `src/lib/typedChannel.ts` — typed pub/sub channel primitive (the single communication building block)
- `src/contracts/runtimeChannels.ts` — runtime channel registry (settingsChanged, connectionChanged, codeEvaluated, etc.)
- `src/contracts/visualisationChannels.ts` — visualisation channel registry
- `src/contracts/gamepadChannels.ts` — gamepad channel registry
- `src/ui/help/helpChannels.ts` — help-panel-local channels
- `src/utils/settingsStore.ts` — reactive settings store (mirror of appSettingsRepository)
- `src/utils/visualisationStore.ts` — reactive visualisation state store
- `src/utils/consoleStore.ts` — reactive console message store
- `src/utils/referenceStore.ts` — reactive function-reference store
- `src/utils/snippetStore.ts` — reactive snippet store
- `src/utils/outputHealthStore.ts` — reactive per-output health store (runtime/eval layer → editor health UI)
- `src/runtime/appSettingsRepository.ts` — canonical non-reactive settings holder
- `src/runtime/runtimeSessionStore.ts` — reactive connection/session state (`createStore` + `createEffect`)
- `src/runtime/runtimeService.ts` — sole settings mutation surface (fans out to repository + channel)
- `src/effects/visualisationRuntime.ts` — the rAF loop owner: drives time updates, drains the sampling queue, polls active diagnostics into `outputHealthStore`, and invokes the registered render hook
- `src/lib/persistence.ts` — localStorage persistence service

---

1.1 Inter-module communication uses **typed pub/sub channels** from a single primitive (see `src/lib/typedChannel.ts`). CustomEvents and globals are forbidden for runtime/visualisation/gamepad/help signals.

1.2 The **canonical reactive stores** are: `settingsStore`, `visStore`, `consoleStore`, `referenceStore`, `snippetStore`, `outputHealthStore`. UI reads from stores; mutations go through named functions or the runtime service.

1.3 **Settings is the only mutation surface that fans out to multiple stores.** All other stores are mutated by their owning subsystem only.

1.4 **One non-reactive state holder** is a deliberate exception: `appSettingsRepository` (see `src/runtime/appSettingsRepository.ts`; canonical settings; the reactive `settingsStore` mirrors it). `runtimeSessionStore` is a reactive Solid store (`createStore` + `createEffect`); UI subscribes via `runtimeService`. Plus 9 imperative `CircularBuffer`s in the stream parser. Adding more non-reactive state requires explicit justification.

1.5 **Channel registries** live in `src/contracts/` (see `src/contracts/runtimeChannels.ts`, `src/contracts/visualisationChannels.ts`, `src/contracts/gamepadChannels.ts`). Adding a channel requires registering it in this spec's inventory.

1.6 **No back-edges from leaves to foundation.** Import boundaries enforce: `lib/` and `contracts/` must not import from runtime/effects/transport/editors/ui. Lint enforces; exceptions are explicit and documented.

## 2. Store Inventory

| Store | Type | Mutated via | Notes |
|---|---|---|---|
| `settingsStore` | `AppSettings` | `runtimeService.updateSettings()` -> repository -> `settingsChanged` | Reactive mirror of `appSettingsRepository` |
| `visStore` | `VisualisationState` | Named functions in `visualisationStore.ts` | Time, palette, expressions, render settings |
| `consoleStore` | `ConsoleState` | `addConsoleMessage()`, `clearConsole()` | Chronological console messages |
| `referenceStore` | Reference data | Reference-store mutation helpers | Function-reference star/expand/target-version state |
| `snippetStore` | Snippet data | Snippet-store mutation helpers | User snippets and starter snippets |
| `outputHealthStore` | `OutputHealthState` | `markOutputRunning()` / diagnostic poll in `outputHealthStore.ts` | Per-output health (`idle`/`running`/`fallback`/`error`); owned by runtime/eval layer, read by editor health UI |

## 3. Channel Inventory

Runtime channels (see `src/contracts/runtimeChannels.ts`):

| Channel | Payload | Publisher(s) | Subscriber(s) |
|---|---|---|---|
| `settingsChanged` | `AppSettings` | `runtimeService` | `settingsStore` |
| `connectionChanged` | `ConnectionChangedDetail` | `runtimeService` | Toolbars, transport orchestration |
| `protocolReady` | `ProtocolReadyDetail` | JSON protocol driver | Transport orchestration |
| `jsonMeta` | `JsonMetaEventDetail` | JSON protocol driver | Transport orchestration |
| `codeEvaluated` | `CodeEvaluatedDetail` | Runtime/evaluation layer | Visualisation sampler and editor feedback |
| `runtimeDiagnostics` | diagnostic snapshot | `runtimeDiagnostics` | Diagnostics UI |
| `bootstrapFailure` | failure detail | `runtimeDiagnostics` | Recovery UI |
| `animateConnect` | `AnimateConnectDetail` | JSON protocol driver (not-connected) | Connect-button animation (UI) |
| `devicePluggedIn` | `DevicePluggedInDetail` | `connector.ts` (saved device replug) | Reconnect UI / prompt |
| `driftDetected` | `DriftDetectedDetail` | `driftDetector` | `stateSyncOrchestrator` |
| `liveEditValueChanged` | `LiveEditValueChangedDetail` | live-edit runtime | `visualisationSampler` |
| `standaloneDiagnostics` | `StandaloneDiagnosticsDetail` | JSON protocol driver (spec §5.9) | Diagnostics UI |

Visualisation channels (see `src/contracts/visualisationChannels.ts`):

| Channel | Payload | Publisher(s) | Subscriber(s) |
|---|---|---|---|
| `visualisationSessionChannel` | session detail | Visualisation sampler | Editor decorations |
| `serialVisPaletteChangedChannel` | palette detail | Theme/visualisation utilities | Visualisation sampler |
| `serialVisAutoOpenChannel` | `undefined` | Visualisation panel adapter | Visualisation panel |

Gamepad channels (see `src/contracts/gamepadChannels.ts`) carry only typed gamepad pipeline events into editor/menu adapters. New gamepad-visible operations should prefer the action registry and resolver path before adding bespoke channels.

Help channels (see `src/ui/help/helpChannels.ts`) are limited to help-panel-local routing such as reference search and tab switching.

## 4. Data Flow Paths

Hardware visualisation path:

```text
Serial port -> connector -> stream parser
  -> binary STREAM frames -> serial buffers / visualisation store
  -> JSON messages -> JSON protocol driver -> typed channels
  -> WebGL renderer reads visualisation store on rAF
```

Browser-local path:

```text
visualisationRuntime internal clock -> visualisation store time update
  -> WASM sampling/projection
  -> visualisation store
  -> WebGL renderer
```

Settings path:

```text
settings UI -> runtimeService.updateSettings()
  -> appSettingsRepository normalise/persist
  -> settingsChanged channel
  -> settingsStore reconcile
  -> subscribers react
```

Gamepad path:

```text
Gamepad hardware poll
  -> logical event normalisation
  -> gesture recognizer / axis frames
  -> resolver / layer stack
  -> action dispatcher or typed channel bridge
```

This inventory is descriptive and should be updated with the code. The invariants in §1 are normative.
