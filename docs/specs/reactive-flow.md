# Reactive Flow

> Spec: typed-channel invariants, mutation surfaces, import boundaries, and channel/store inventory. Counterpart to [MAIN.md](MAIN.md).

1.1 Inter-module communication uses **typed pub/sub channels** from a single primitive. CustomEvents and globals are forbidden for runtime/visualisation/gamepad/help signals.

1.2 The **canonical reactive stores** are: `settingsStore`, `visStore`, `consoleStore`, `referenceStore`, `snippetStore`. UI reads from stores; mutations go through named functions or the runtime service.

1.3 **Settings is the only mutation surface that fans out to multiple stores.** All other stores are mutated by their owning subsystem only.

1.4 **Two non-reactive state holders** are deliberate exceptions: `appSettingsRepository` (canonical settings; reactive store mirrors it) and `runtimeSessionStore` (connection/session state; UI subscribes via `runtimeService`). Plus 9 imperative `CircularBuffer`s in the stream parser. Adding more non-reactive state requires explicit justification.

1.5 **Channel registries** live in `src/contracts/`. Adding a channel requires registering it in this spec's inventory.

1.6 **No back-edges from leaves to foundation.** Import boundaries enforce: `lib/` and `contracts/` must not import from runtime/effects/transport/editors/ui. Lint enforces; exceptions are explicit and documented.

## 2. Store Inventory

| Store | Type | Mutated via | Notes |
|---|---|---|---|
| `settingsStore` | `AppSettings` | `runtimeService.updateSettings()` -> repository -> `settingsChanged` | Reactive mirror of `appSettingsRepository` |
| `visStore` | `VisualisationState` | Named functions in `visualisationStore.ts` | Time, palette, expressions, render settings |
| `consoleStore` | `ConsoleState` | `addConsoleMessage()`, `clearConsole()` | Chronological console messages |
| `referenceStore` | Reference data | Reference-store mutation helpers | Function-reference star/expand/target-version state |
| `snippetStore` | Snippet data | Snippet-store mutation helpers | User snippets and starter snippets |

## 3. Channel Inventory

Runtime channels live in `src/contracts/runtimeChannels.ts`:

| Channel | Payload | Publisher(s) | Subscriber(s) |
|---|---|---|---|
| `settingsChanged` | `AppSettings` | `runtimeService` | `settingsStore` |
| `connectionChanged` | `ConnectionChangedDetail` | `runtimeService` | Toolbars, transport orchestration |
| `protocolReady` | `ProtocolReadyDetail` | JSON protocol driver | Transport orchestration |
| `jsonMeta` | `JsonMetaEventDetail` | JSON protocol driver | Transport orchestration |
| `codeEvaluated` | `CodeEvaluatedDetail` | Runtime/evaluation layer | Visualisation sampler and editor feedback |
| `runtimeDiagnostics` | diagnostic snapshot | `runtimeDiagnostics` | Diagnostics UI |
| `bootstrapFailure` | failure detail | `runtimeDiagnostics` | Recovery UI |

Visualisation channels live in `src/contracts/visualisationChannels.ts`:

| Channel | Payload | Publisher(s) | Subscriber(s) |
|---|---|---|---|
| `visualisationSessionChannel` | session detail | Visualisation sampler | Editor decorations |
| `serialVisPaletteChangedChannel` | palette detail | Theme/visualisation utilities | Visualisation sampler |
| `serialVisAutoOpenChannel` | `undefined` | Visualisation panel adapter | Visualisation panel |

Gamepad channels live in `src/contracts/gamepadChannels.ts` and carry only typed gamepad pipeline events into editor/menu adapters. New gamepad-visible operations should prefer the action registry and resolver path before adding bespoke channels.

Help channels live in `src/ui/help/helpChannels.ts` and are limited to help-panel-local routing such as reference search and tab switching.

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
localClock -> visualisation store time update
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
