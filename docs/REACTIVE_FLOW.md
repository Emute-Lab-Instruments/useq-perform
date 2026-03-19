# Reactive Data Flow

How data moves through the application. Consult this before tracing state or adding new reactive plumbing.

## Stores

Five SolidJS stores hold all reactive UI state. All are in `src/utils/`.

| Store | Type | Mutated via | Nesting |
|-------|------|-------------|---------|
| `settings` | `AppSettings` | `updateSettingsStore()` -> `runtimeService` | 2 levels (section.leaf) |
| `visStore` | `VisualisationState` | Named mutation functions in `visualisationStore.ts` | 3-4 levels (expressions have samples) |
| `consoleStore` | `ConsoleState` | `addConsoleMessage()`, `clearConsole()` | 2 levels |
| `referenceStore` | Reference data | `toggleStarred()`, `toggleExpanded()`, `setTargetVersion()` | 2 levels (items are read-only) |
| `snippetStore` | Snippet data | `addSnippet()`, `updateSnippet()`, `deleteSnippet()` | 2 levels |

### settings (AppSettings)

```
settings
  .name                           string
  .editor.{code, theme, fontSize, preventBracketUnbalancing}
  .storage.{saveCodeLocally, autoSaveEnabled, autoSaveInterval}
  .ui.{consoleLinesLimit, customThemes, osFamily, expressionGutterEnabled, ...}
  .visualisation.{windowDuration, sampleCount, lineWidth, futureDashed, ...}
  .runtime.{autoReconnect, startLocallyWithoutHardware}
  .wasm.{enabled}
  .keymaps?                       Record<string, string>
```

**Mutation surface**: `updateSettingsStore(patch)` -> `runtimeService.updateSettings()` -> `appSettingsRepository` (normalises, persists to localStorage) -> publishes `settingsChanged` channel -> `settingsStore` subscribes, calls `setSettings(reconcile(...))`.

### visStore (VisualisationState)

```
visStore
  .currentTime / .displayTime     number (seconds)
  .bar                            number (0..1)
  .lastChangeKind                 string
  .palette                        string[]
  .settings                       VisSettings (mirrors settings.visualisation)
  .expressions                    Record<exprType, { exprType, expressionText, samples[], color }>
  .serialBuffers                  { channels: number[][], lengths: number[] }
```

**Mutation surface**: All updates go through named functions in `visualisationStore.ts` (`updateTime`, `updateBar`, `updateExpressions`, `removeExpression`, `updateSettings`, `setLastChangeKind`, `setVisPalette`). The primary caller is `visualisationSampler.ts`.

### consoleStore

```
consoleStore
  .messages[]                     { id, type, content, timestamp }
  .nextId                         number
```

### referenceStore / snippetStore

Read-only reference data and user snippets with star/expand tracking. Both use `Set` values (replaced wholesale on mutation since SolidJS stores don't track `Set` internals).

## Signals

Key module-scoped signals (not in stores):

| Signal | Location | Description |
|--------|----------|-------------|
| `editor` | `src/lib/editorStore.ts` | Active CodeMirror `EditorView` instance |
| `settingsVisible`, `helpVisible` | `src/ui/adapters/panels.tsx` | Panel visibility toggles |
| `modalState` | `src/ui/adapters/modal.tsx` | Current modal content |
| `menuState` | `src/ui/adapters/picker-menu.tsx` | Picker menu state |
| Radial menu signals | `src/ui/adapters/double-radial-menu.tsx` | Menu open/categories/size |

## Typed Channels

All inter-module communication uses typed pub/sub channels from `src/lib/typedChannel.ts`. Definitions live in `src/contracts/`.

### Runtime Channels (`src/contracts/runtimeChannels.ts`)

| Channel | Payload | Publisher(s) | Subscriber(s) |
|---------|---------|-------------|----------------|
| `settingsChanged` | `AppSettings` | `runtimeService` | `settingsStore` |
| `connectionChanged` | `ConnectionChangedDetail` | `runtimeService` | `MainToolbar`, `transportOrchestrator` |
| `protocolReady` | `ProtocolReadyDetail` | `json-protocol` | `transportOrchestrator` |
| `jsonMeta` | `JsonMetaEventDetail` | `json-protocol` | `transportOrchestrator` |
| `codeEvaluated` | `CodeEvaluatedDetail` | `wasmInterpreter` | `visualisationSampler` |
| `animateConnect` | `undefined` | `json-protocol` | `MainToolbar` |
| `devicePluggedIn` | `undefined` | `connector` | auto-reconnect logic |
| `runtimeDiagnostics` | snapshot | `runtimeDiagnostics` | diagnostics UI |
| `bootstrapFailure` | failure detail | `runtimeDiagnostics` | diagnostics UI |

### Visualisation Channels (`src/contracts/visualisationChannels.ts`)

| Channel | Payload | Publisher(s) | Subscriber(s) |
|---------|---------|-------------|----------------|
| `visualisationSessionChannel` | session detail | `visualisationSampler` | `decorations.ts` (eval highlight) |
| `serialVisPaletteChangedChannel` | palette detail | `visualisationUtils` | `visualisationSampler` |
| `serialVisAutoOpenChannel` | `undefined` | `visualisationPanel` | vis panel auto-open |

### Gamepad Channels (`src/contracts/gamepadChannels.ts`)

| Channel | Publisher | Subscriber |
|---------|----------|------------|
| `navigate`, `enter`, `back`, `evalNow`, `deleteNode`, `adjustNumber`, `toggleManualControl`, `stickAxis` | `gamepadIntents` | `gamepadNavigation` |
| `openMenu`, `openRadialMenu` | `gamepadIntents` | `gamepadMenuBridge` |
| `pickerNavigate`, `pickerSelect`, `pickerCancel`, `pickerApply` | `gamepadIntents` | `PickerMenu`, `DoubleRadialPicker` |
| `controllerMode` | `gamepadMenuBridge` | `gamepadIntents` |

### Help Channels (`src/ui/help/helpChannels.ts`)

| Channel | Publisher | Subscriber |
|---------|----------|------------|
| `referenceSearchChannel` | `editorKeyboard` (Alt-F) | `ModuLispReferenceTab` |
| `helpTabSwitchChannel` | `ModuLispReferenceTab` | `Tabs` |

## Data Flow Paths

### Hardware path: Serial -> Vis -> Canvas

```
Serial Port
  -> connector.ts (opens port, starts reader)
  -> stream-parser.ts
     |-- STREAM ch0 (time) -> visStore.updateTime()
     |                      -> resampleExpressions() -> WASM eval -> visStore.updateExpressions()
     |-- STREAM ch1-8      -> serialBuffers (CircularBuffer, not reactive)
     |-- JSON messages      -> json-protocol -> channels -> transportOrchestrator
     |-- TEXT messages      -> consoleStore.addConsoleMessage()
  -> serialVis.ts reads visStore on rAF loop -> canvas
```

### No-hardware path: Local Clock -> Vis

```
localClock.ts (rAF, performance.now)
  -> visStore.updateTime()
  -> resampleExpressions() -> WASM eval -> visStore updates
  -> serialVis.ts reads on rAF -> canvas
```

**Sampling guards**: `resampleExpressions` uses a monotonic sequence counter to discard stale async results. The local clock adds a `samplingInFlight` coalescing guard to avoid queuing redundant WASM work. All active expressions are evaluated in a single `evalOutputsInTimeWindow` batch call (falling back to per-expression on error).

### Code evaluation: Editor -> WASM -> Vis

```
CodeMirror edit
  -> editorEvaluation.ts
  -> wasmInterpreter.ts
     -> codeEvaluated channel
     -> visualisationSampler subscribes -> rebuildAllExpressions()
     -> visStore updates -> canvas re-render
```

### Settings: UI -> Repository -> Stores -> Everything

```
Settings panel event handler
  -> updateSettingsStore(patch)
  -> runtimeService.updateSettings()
  -> appSettingsRepository (normalise, persist to localStorage)
  -> settingsChanged channel
  -> settingsStore (reconcile update)
  -> all UI components reading settings react
  -> visualisationSampler reloads vis settings
  -> editor reconfigures autosave
```

### Transport state: Machine -> Clock -> Vis

```
Play/Pause/Stop button
  -> transportOrchestrator.send(event)
  -> XState transport machine transitions
  -> emitPlay/emitPause/emitStop actions -> json-protocol -> hardware
  -> applyClockPolicy() starts/stops/resumes localClock
  -> localClock drives visStore.currentTime
```

### Gamepad: Hardware -> Intents -> Editor/Menus

```
Gamepad (polled by gamepadManager)
  -> gamepadIntents.ts (button/stick -> typed intent)
  -> normal mode:  gamepadNavigation.ts (cursor, eval, delete)
  -> picker mode:  PickerMenu/DoubleRadialPicker (menu navigation)
  -> menu open:    gamepadMenuBridge (opens picker/radial, publishes controllerMode)
```

## Non-Reactive State

Two important state holders live outside SolidJS reactivity:

- **`appSettingsRepository`** (`src/runtime/appSettingsRepository.ts`) — canonical settings source, plain JS with listener pattern. The SolidJS `settingsStore` is a reactive mirror synced via `settingsChanged` channel.
- **`runtimeSessionStore`** (`src/runtime/runtimeSessionStore.ts`) — connection/session state, plain JS with `Set<Listener>`. UI subscribes via `runtimeService.subscribeRuntimeService()`.
- **`serialBuffers`** (`src/transport/stream-parser.ts`) — 9 `CircularBuffer` instances, imperatively mutated. Not reactive.
