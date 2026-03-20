# Glossary

Single source of truth for terminology in the useq-perform codebase.

**How to read this file**: Each entry lists every code identifier tied to that
concept. If you rename a term, the identifiers show exactly what needs changing
in code.

**How to edit**: Change the **Term** heading and/or definition. Leave the
identifiers as-is — the diff between the old term and new term tells an agent
(or human) precisely which renames to perform. Mark entries `(deprecated)` to
signal removal; add `(rename → NewTerm)` to signal a rename.

**Spelling convention**: British English (visualisation, analogue, colour)
unless an external API forces otherwise.

---

## Hardware & Domain

### uSEQ

The umbrella term for this project. Originally refers to the Emute Lab Instruments uSEQ Eurorack module, now generally refers to this approach of using functions of time to turn a programmable, Lisp-driven REPL into a modular synthesiser sequencer and controller.

- **Identifiers**: `useq` prefix in event names (`useq-connection-changed`, etc.)
- **Not**: "device" (too generic), "board"

### uSEQ Perform

The web live-coding interface for uSEQ. This repository.

- **Identifiers**: `useq-perform` (repo name, package name)
- **Files**: `package.json`

### ModuLisp

The Lisp dialect executed on uSEQ hardware or the in-browser WASM interpreter.

- **Identifiers**: `ModuLispInterpreter`, `modulisp` (submodule at `deps/modulisp/`)
- **Files**: `deps/modulisp/`, `src/runtime/wasmInterpreter.ts`
- **Not**: "Lisp" alone (ambiguous)
- **See also**: WASM, Expression

### Expression

A Lisp code string (S-Expression) being evaluated or visualised. In the visualisation context,
one expression maps to one waveform lane.

- **Identifiers**: `VisExpression`, `exprType`, `expression`
- **Files**: `src/utils/visualisationStore.ts`
- **Not**: "code" (broader — code is the full editor contents; expression is one evaluable unit)
- **See also**: Code

### Code

The full Lisp source text in the editor, sent to hardware or WASM for evaluation.

- **Identifiers**: `code` (parameter name throughout), `useqcode` (legacy storage key, deprecated)
- **See also**: Expression, Eval Request

### Snippet

A saved code fragment with title, tags, and timestamp.

- **Identifiers**: `Snippet`, `snippetStore`, `SnippetStore`
- **Files**: `src/utils/snippetStore.ts`

### Bar

Beat position (0–1) within the current musical bar/measure.

- **Identifiers**: `bar` (field in `VisualisationState`)
- **Files**: `src/utils/visualisationStore.ts`

---

## Channels & I/O

### Channel

A named hardware I/O port. Inputs and outputs are both channels.

- **Identifiers**: `IoChannelConfig`, `StreamChannelConfig`
- **Files**: `src/runtime/jsonProtocol.ts`
- **See also**: Input, Output, Stream

### Input

An analogue input channel on the hardware. Firmware names: `ssin1`–`ssin8`.
1-indexed to match the `(ssin N)` Lisp builtin.

- **Identifiers**: `inputs` (array in `IoConfig`), `ssin1`..`ssin8`
- **Files**: `src/runtime/jsonProtocol.ts`
- **Not**: "sensor" (too specific)

### Output

A serial stream output channel. Index 1 = `time`, indices 2–9 = `s1`–`s8`.

- **Identifiers**: `outputs` (array in `IoConfig`), `s1`..`s8`, `time`
- **Files**: `src/runtime/jsonProtocol.ts`
- **Not**: "serial output" (ambiguous with the serial port itself)

### Analogue Channel

Continuous-value output channels `a1`–`a4`.

- **Identifiers**: `a1`, `a2`, `a3`, `a4`, `ANALOGUE_CHANNELS`
- **Files**: `src/utils/visualisationStore.ts`
- **Spelling**: "analogue" (British), not "analog"

### Digital Channel

Gate/trigger output channels `d1`–`d3`.

- **Identifiers**: `d1`, `d2`, `d3`, `DIGITAL_CHANNELS`
- **Files**: `src/utils/visualisationStore.ts`

### Mock Control Input

Devmode-only simulated hardware inputs for testing without a physical module.

- **Identifiers**: `ain1`, `ain2` (analogue CV, 0–1), `din1`, `din2` (digital pulse, 0/1), `swm` (momentary switch), `swt` (toggle switch, 0/0.5/1)
- **Files**: `src/effects/mockControlInputs.ts`

### Control Definition

Describes a single mock control input for UI rendering: name, label, description,
type (continuous/binary/ternary), min, max, step, default.

- **Identifiers**: `ControlDefinition`, `ControlName`, `ControlType`, `getControlDefinitions()`
- **Files**: `src/effects/mockControlInputs.ts`

### Firmware Version

Semantic version of the connected uSEQ firmware. Determines protocol eligibility
and feature availability.

- **Identifiers**: `FirmwareVersion` (`major`, `minor`, `patch`), `versionAtLeast()`, `isJsonEligibleVersion()`, `JSON_PROTOCOL_MIN_VERSION` (1.2.0)
- **Files**: `src/runtime/jsonProtocol.ts`
- **See also**: Protocol, Hello Handshake

### IoConfig

The hardware I/O layout received during the hello handshake: optional arrays of
input and output channel definitions.

- **Identifiers**: `IoConfig`, `IoChannelConfig` (`index`, `name`), `StreamChannelConfig`, `StreamChannelDirection`
- **Files**: `src/runtime/jsonProtocol.ts`
- **See also**: Channel, Hello Handshake

---

## Transport & Connection

### Transport

The serial communication layer between the web UI and uSEQ hardware.
Also the name of the state machine governing playback state.

- **Identifiers**: `TransportState`, `TransportEvent`, `TransportToolbar`, `mountTransportToolbar`
- **Files**: `src/transport/` (directory), `src/machines/transport.machine.ts`
- **Not**: "connection" (too vague — connection is one aspect of transport), "serial" (too low-level), "comms"
- **See also**: Protocol, Serial Port

### Transport State

Playback state of the sequencer: playing, paused, or stopped.

- **Identifiers**: `TransportState` (`"playing"` | `"paused"` | `"stopped"`), `SharedTransportCommand`, `SharedTransportBuiltin`
- **Files**: `src/machines/transport.machine.ts`, `src/effects/transport.ts`
- **Lisp builtins**: `(useq-play)`, `(useq-pause)`, `(useq-stop)`, `(useq-rewind)`, `(useq-clear)`

### Protocol

The wire format for communication. Two modes exist.

- **Identifiers**: `ProtocolMode` (`"legacy"` | `"json"`), `PROTOCOL_READY_EVENT`
- **Files**: `src/transport/types.ts`, `docs/PROTOCOL.md`
- **See also**: JSON Mode, Legacy Mode

### JSON Mode

Structured request/response protocol for firmware ≥ 1.2.0. Supports request
IDs, heartbeat, stream config, and typed responses.

- **Identifiers**: `"json"` (ProtocolMode value)
- **Files**: `src/transport/json-protocol.ts`
- **See also**: Hello Handshake, Heartbeat, Eval Request

### Legacy Mode

Plain-text Lisp evaluation. Fallback for older firmware.

- **Identifiers**: `"legacy"` (ProtocolMode value)
- **Files**: `src/transport/types.ts`

### Hello Handshake

The initial JSON protocol exchange. Editor sends `hello`, firmware responds with
version and I/O config. Initiates JSON mode if firmware supports it.

- **Identifiers**: `hello` (request type)
- **Files**: `docs/PROTOCOL.md`
- **See also**: IoConfig

### Heartbeat

60-second keepalive probe in JSON mode. 10-second timeout.

- **Identifiers**: `ping` (request type), `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS`
- **Files**: `src/transport/types.ts`

### Eval Request

A code evaluation request sent over the protocol.

- **Identifiers**: `type: "eval"`, `exec: "immediate"` (optional flag)
- **Event**: `CODE_EVALUATED_EVENT` / `useq-code-evaluated`
- **Files**: `docs/PROTOCOL.md`, `src/contracts/runtimeEvents.ts`

### Stream

A binary serial data frame (11 bytes: marker + type + channel + f64 value).
Carries real-time channel data from hardware.

- **Identifiers**: `STREAM` (message type `0x00`), `StreamChannelConfig`, `SerialReadMode.SERIALSTREAM`
- **Files**: `src/transport/types.ts`
- **Not**: "serial stream" (redundant)

### Pending Request

A tracked in-flight JSON protocol request awaiting a response.

- **Identifiers**: `PendingRequest` (promise, reject, capture, skipConsole, timeout)
- **Files**: `src/transport/types.ts`

### Protocol State

Module-level singleton tracking the current protocol mode, negotiation status,
request ID counter, pending request map, I/O config, and heartbeat interval.

- **Identifiers**: `ProtocolState`, `PROTOCOL_MODES` (`LEGACY`, `JSON`)
- **Files**: `src/transport/index.ts`
- **Not**: confused with Transport State (playback) or Protocol (wire format)

### Json Response

Typed interface for a JSON protocol response from firmware. Contains optional
fields for requestId, text, console output, admin, meta, success, type, mode,
config, and firmware version.

- **Identifiers**: `JsonResponse`, `JsonMetaResponse`
- **Files**: `src/transport/index.ts`, `src/contracts/runtimeEvents.ts`

### Serial Read Mode

Byte-level parsing state controlling how incoming serial bytes are interpreted.

- **Identifiers**: `SERIAL_READ_MODES` (`ANY`, `TEXT`, `SERIALSTREAM`, `JSON`), `SerialReadMode`, `MESSAGE_START_MARKER` (byte `31`), `MESSAGE_TYPES` (`STREAM: 0`, `JSON: 101`)
- **Files**: `src/transport/index.ts`, `src/transport/types.ts`
- **See also**: Stream, Protocol

### Serial Buffer

Exported array of 9 `CircularBuffer` instances (capacity 400) that buffer
incoming stream values from hardware. Optional map functions transform data
as it arrives.

- **Identifiers**: `serialBuffers`, `serialMapFunctions`, `serialOutputBufferRouting`, `BufferMapFunction`
- **Files**: `src/transport/index.ts`
- **See also**: Stream, Circular Buffer

### Smoothing

Value smoothing and interpolation applied to incoming serial data for
smoother visualisation rendering.

- **Identifiers**: `SmoothingConfig`, `smoothingSettings`, `applySmoothing()`, `applyInterpolation()`, `PushableBuffer`
- **Files**: `src/transport/serial-utils.ts`

### Meta

Transport state or metadata payload in a JSON protocol response. Dispatched as
a DOM event.

- **Identifiers**: `meta` (response field), `useq-json-meta` (event name)
- **Files**: `src/contracts/runtimeEvents.ts`

---

## Runtime & Startup

### Runtime

The execution environment — bootstrap, diagnostics, settings persistence,
session management.

- **Identifiers**: `RuntimeSettings`, `RuntimeConnectionMode`, `RuntimeSessionSnapshot`
- **Files**: `src/runtime/` (directory)
- **Not**: "app" (too broad)

### Bootstrap Plan

The startup decision: which mode to use based on hardware availability, WASM
support, and user settings.

- **Identifiers**: `BootstrapPlan`, `BootstrapStartupMode`
- **Files**: `src/runtime/bootstrap.ts`

### Startup Mode

The resolved startup path chosen by the bootstrap plan.

- **Identifiers**: `BootstrapStartupMode` (`"hardware"` | `"browser-local"` | `"no-module"` | `"unsupported-browser"`)
- **Files**: `src/runtime/bootstrap.ts`

### Environment State

Captured browser capabilities at startup: WebSerial availability, devmode flag,
user settings snapshot.

- **Identifiers**: `EnvironmentState`
- **Files**: `src/runtime/startupContext.ts`

### Connection Mode

Where code executes.

- **Identifiers**: `RuntimeConnectionMode` (`"hardware"` | `"browser"` | `"none"`)
- **Files**: `src/runtime/runtimeSession.ts`

### Transport Mode

Which runtime(s) receive shared transport commands (play/pause/stop).

- **Identifiers**: `TransportMode` (`"hardware"` | `"wasm"` | `"both"` | `"none"`)
- **Files**: `src/runtime/runtimeSession.ts`
- **Not**: confused with Transport (the communication layer) or Transport State (playback)

### Runtime Session

The resolved runtime shape for the current session.

- **Identifiers**: `RuntimeSessionSnapshot`, `runtimeSessionStore`
- **Files**: `src/runtime/runtimeSession.ts`, `src/runtime/runtimeSessionStore.ts`

### URL Parameters

Startup flags passed via query string that override default behaviour.

- **Identifiers**: `debug`, `devmode`, `disableWebSerial`, `noModuleMode`, `nosave`
- **Files**: `src/runtime/urlParams.ts`

### Runtime Diagnostics

A snapshot of the resolved runtime state for debugging: startup mode, protocol
mode, settings sources, active environment, bootstrap failures.

- **Identifiers**: `RuntimeDiagnosticsSnapshot`, `reportBootstrapFailure()`
- **Files**: `src/runtime/diagnostics.ts`
- **Failure scopes**: `ui-adapter-mount`, and others from initialisation

### Startup Flags

Boolean feature flags parsed from URL query parameters that override default
startup behaviour.

- **Identifiers**: `StartupFlags` (`debug`, `devmode`, `disableWebSerial`, `noModuleMode`, `nosave`, `params`), `readStartupFlags()`
- **Files**: `src/runtime/startupContext.ts`, `src/runtime/urlParams.ts`
- **See also**: URL Parameters, Bootstrap Plan

### Environment Capabilities

Detected browser capabilities at startup, used by the bootstrap plan to decide
which startup mode is possible.

- **Identifiers**: `EnvironmentCapabilities` (`areInBrowser`, `areInDesktopApp`, `isWebSerialAvailable`)
- **Files**: `src/runtime/startupContext.ts`
- **See also**: Environment State, Bootstrap Plan

### Bootstrap Result

The aggregate output of the bootstrap sequence: app instance, UI references,
environment state, and the derived bootstrap plan.

- **Identifiers**: `BootstrapResult`, `bootstrap()`
- **Files**: `src/runtime/bootstrap.ts`
- **See also**: Bootstrap Plan, Environment State

### Settings Source

Where a settings value originated, used for diagnostics and conflict resolution
during layered settings loading.

- **Identifiers**: `RuntimeSettingsSource` (`"defaults"`, `"local-storage"`, `"url-config"`, `"url-code"`, `"nosave"`)
- **Files**: `src/runtime/runtimeDiagnostics.ts`
- **See also**: AppSettings, Repository

### Legacy Runtime Adapter

Imperative interface formerly bridging modern runtime code to the legacy transport
subsystem. Now inlined into `runtimeService.ts`.

- **Identifiers**: `LegacyRuntimeAdapter`, `LegacyRuntimeState`
- **Files**: `src/runtime/runtimeService.ts`
- **Not**: confused with Adapter (UI mounting)

### Configuration Validation

Validation and normalization utilities for configuration documents.

- **Identifiers**: `validateConfiguration()`, `getConfigurationDiff()`
- **Files**: `src/lib/settings/normalization.ts`
- **See also**: AppSettings, AppConfigDocument

---

## Effects & Machines

### Effect

A standalone side-effect module — composable, testable, framework-agnostic.

- **Identifiers**: varies per module
- **Files**: `src/effects/` (directory)
- **Not**: XState's `effect` parameter (different concept)
- **Modules**: `transport.ts`, `editor.ts`, `ui.ts`, `localClock.ts`, `transportClock.ts`, `transportOrchestrator.ts`

### Transport Effect

Side-effect module implementing shared transport commands (play, pause, stop,
rewind, clear, getState). Branches on `resolveTransportMode()` to target
hardware, WASM, or both.

- **Identifiers**: `play()`, `pause()`, `stop()`, `rewind()`, `clear()`, `getState()`, `resolveTransportMode()`
- **Files**: `src/effects/transport.ts`

### Transport Orchestrator

XState-based orchestration of transport state machine transitions.

- **Identifiers**: `transportOrchestrator`
- **Files**: `src/effects/transportOrchestrator.ts`

### Transport Clock

Time synchronisation policy between mock clock, WASM, and display rendering.
Decides whether the mock time generator should run.

- **Identifiers**: `shouldUseMockTime()`, `applyMockTimePolicy()`
- **Files**: `src/effects/transportClock.ts`
- **See also**: Mock Time Generator

### Mock Time Generator

A ~60fps animation loop that generates synthetic time values for the
visualisation when hardware isn't providing them.

- **Identifiers**: `mockTimeGenerator`
- **Files**: `src/effects/localClock.ts`

### Editor Effect

Side-effects for editor operations: font size adjustment, code save/load
via File System Access API.

- **Identifiers**: `adjustFontSize()`, `loadCode()`, `saveCode()`
- **Files**: `src/effects/editor.ts`

### UI Effect

Side-effects for UI operations (panel toggling, toolbar actions, etc.).

- **Files**: `src/effects/ui.ts`

### Machine

An XState state machine. Currently only the transport machine exists.

- **Identifiers**: `transport.machine.ts`
- **Files**: `src/machines/` (directory), `src/machines/transport.machine.ts`
- **See also**: Transport State

### Transport Context

The XState machine context holding the resolved transport mode.

- **Identifiers**: `TransportContext` (`mode: "hardware" | "wasm" | "both" | "none"`)
- **Files**: `src/machines/transport.machine.ts`
- **See also**: Transport Mode, Machine

### Transport Event

Discriminated union of events the transport machine accepts.

- **Identifiers**: `TransportEvent` (`PLAY`, `PAUSE`, `STOP`, `REWIND`, `CLEAR`, `SYNC`, `UPDATE_MODE`)
- **Files**: `src/machines/transport.machine.ts`
- **`SYNC`**: sets machine state to match hardware without firing emit actions
- **`UPDATE_MODE`**: updates context mode without changing playback state

### Action Injection

Pattern used by machines: stub actions are exported and overridden at runtime
via `machine.provide({ actions })`. Keeps machines framework-agnostic.

- **Identifiers**: `emitPlay`, `emitPause`, `emitStop`, `emitRewind`, `emitClear`, `syncWasmPlay`, `syncWasmPause`, `syncWasmStop`
- **Files**: `src/machines/transport.machine.ts`
- **See also**: Transport Orchestrator

---

## Settings & State

### AppSettings

The root user configuration object. Contains nested setting groups.

- **Identifiers**: `AppSettings` (interface), `DEFAULT_APP_SETTINGS`
- **Files**: `src/lib/appSettings.ts`
- **Children**: EditorSettings, UISettings, VisualisationSettings, RuntimeSettings, StorageSettings, WasmSettings

### EditorSettings

Code editor preferences: theme, font size, bracket balancing.

- **Identifiers**: `EditorSettings`
- **Files**: `src/lib/appSettings.ts`

### UISettings

UI preferences: console limit, custom themes, OS family, gutter, gamepad picker style.

- **Identifiers**: `UISettings`, `expressionGutterEnabled`, `expressionClearButtonEnabled`, `gamepadPickerStyle`, `osFamily`
- **Files**: `src/lib/appSettings.ts`

### VisualisationSettings

Waveform display preferences.

- **Identifiers**: `VisualisationSettings`
- **Fields**: `windowDuration` (1–20s), `sampleCount` (2–400), `lineWidth` (0.5–5px), `futureDashed`, `futureMaskOpacity` (0–1), `digitalLaneGap` (0–40px), `circularOffset`, `futureLeadSeconds` (0–8)
- **Files**: `src/lib/appSettings.ts`

### RuntimeSettings

Runtime behaviour: auto-reconnect, start locally without hardware.

- **Identifiers**: `RuntimeSettings`, `startLocallyWithoutHardware`
- **Files**: `src/lib/appSettings.ts`

### StorageSettings

Persistence preferences: code auto-save, local save, auto-save interval.

- **Identifiers**: `StorageSettings`, `autoSaveEnabled`, `saveCodeLocally`, `autoSaveInterval`
- **Files**: `src/lib/appSettings.ts`

### WasmSettings

WASM interpreter toggle.

- **Identifiers**: `WasmSettings`, `wasmEnabled`
- **Files**: `src/lib/appSettings.ts`

### Store

A Solid reactive store. The live, subscribable view of state.

- **Identifiers**: `settingsStore`, `consoleStore`, `visStore`, `referenceStore`, `snippetStore`, `runtimeSessionStore`
- **Files**: `src/utils/settingsStore.ts`, `src/utils/consoleStore.ts`, `src/utils/visualisationStore.ts`, `src/utils/referenceStore.ts`, `src/utils/snippetStore.ts`, `src/runtime/runtimeSessionStore.ts`
- **Not**: "state" alone (too generic)

### Repository

Persistence layer. Reads from / writes to localStorage.

- **Identifiers**: `appSettingsRepository`
- **Pattern**: `*Repository` classes
- **Files**: `src/runtime/appSettingsRepository.ts`
- **Flow**: AppSettings type → Repository (persistence) → Store (reactive)

### Typed Channel

A generic pub/sub primitive for type-safe inter-component communication.
Used where DOM events would be too loose or coupling too tight.

- **Identifiers**: `TypedChannel`, `createTypedChannel()`
- **Files**: `src/lib/typedChannel.ts`
- **Instances**: reference search channel, help tab switch channel

### AppSettings Patch

Deep-partial type allowing updates at any nesting level of AppSettings.
Used by settings import and merge operations.

- **Identifiers**: `AppSettingsPatch`, `mergeUserSettings()`, `normalizeUserSettings()`
- **Files**: `src/lib/appSettings.ts`
- **See also**: AppSettings, Repository

### App Config Document

Full configuration export/import envelope: schema version, metadata (timestamp,
source, description), user settings patch, and dev-mode state.

- **Identifiers**: `AppConfigDocument`, `ConfigDocumentMetadata`, `CONFIG_VERSION`, `createConfigurationDocument()`, `settingsPatchFromConfiguration()`
- **Files**: `src/lib/appSettings.ts`
- **See also**: Configuration Management, AppSettings Patch

### Dev-Mode State

Dev-mode toggle and mock control/connection configuration. Persisted separately
from user settings.

- **Identifiers**: `AppDevModeState`, `defaultDevModeConfiguration`
- **Files**: `src/lib/appSettings.ts`
- **See also**: Mock Control Input, URL Parameters

### Stored Settings

Variant of AppSettings where `editor.code` is optional — code is persisted
under a separate localStorage key to avoid bloating the settings object.

- **Identifiers**: `StoredAppSettings`, `createStoredSettingsSnapshot()`, `settingsStorageKey`, `codeStorageKey`
- **Files**: `src/lib/appSettings.ts`
- **See also**: Repository, Autosave

### Typed Event Bus

Pattern used for runtime and visualisation events: a string-keyed DetailMap
interface maps each event name to its typed detail payload, enabling type-safe
dispatch, listen, and read operations.

- **Identifiers**: `RuntimeEventDetailMap`, `RuntimeEventName`, `RUNTIME_EVENT_NAMES`, `dispatchRuntimeEvent()`, `addRuntimeEventListener()`, `readRuntimeEventDetail()`
- **Files**: `src/contracts/runtimeEvents.ts`, `src/contracts/visualisationEvents.ts`
- **Visualisation counterparts**: `VisualisationEventDetailMap`, `VisualisationEventName`, `dispatchVisualisationEvent()`, `addVisualisationEventListener()`
- **See also**: Events (section)

### Runtime Contract

Master capability contract documenting which features are hardware-only,
WASM-only, or optional. Used for validation and documentation.

- **Identifiers**: `EDITOR_RUNTIME_CONTRACT`, `SHARED_TRANSPORT_COMMANDS`, `SHARED_TRANSPORT_COMMAND_LIST`, `TRANSPORT_STATE_TO_COMMAND`, `isSharedTransportCommand()`, `assertEditorRuntimeContract()`
- **Files**: `src/contracts/useqRuntimeContract.ts`
- **See also**: Transport State, WASM

### Effect Resource (deleted)

Formerly a Solid `createResource` wrapper for Effect-TS. Removed during refactoring.

### Actor Signal

SolidJS hook wrapping an XState actor reference into a reactive `{state, send}`
signal pair.

- **Identifiers**: `useActorSignal()`
- **Files**: `src/lib/useActorSignal.ts`
- **See also**: Machine

---

## UI Components

### Panel

A dockable UI container (settings, help, console, reference, etc.).

- **Identifiers**: `Panel*` components, `panelId`, `PanelDef`
- **Files**: `src/ui/panel-chrome/`, `src/ui/adapters/panels.tsx`
- **Not**: "window" (no native window), "pane" (that's a Chrome design)

### Chrome

The window decoration/frame around a panel. Three designs exist.

- **Identifiers**: `Chrome*`, `ChromeDesign` (`"pane"` | `"drawer"` | `"tile"`), `ChromeMode` (`"normal"` | `"expanded"` | `"collapsed"`)
- **Files**: `src/ui/panel-chrome/types.ts`
- **CSS class**: `.panel-chrome`, with variants `.panel-chrome--pane`, `.panel-chrome--drawer`, `.panel-chrome--tile`
- **Not**: confused with the browser

### Pane

A chrome design: free-floating, resizable window with draggable title bar and
eight-point resize handles. Has an edge expand/collapse button.

- **Identifiers**: `PaneChrome`
- **Files**: `src/ui/panel-chrome/PaneChrome.tsx`
- **CSS classes**: `.pane-resize-zone--n`, `.pane-resize-zone--s`, etc. (resize hit targets), `.pane-edge-expand-btn`, `.pane-edge-caret`

### Drawer

A chrome design: right-edge sliding panel with width percentage control.
Shows a collapsed vertical text tab when minimised.

- **Identifiers**: `DrawerChrome`
- **Files**: `src/ui/panel-chrome/DrawerChrome.tsx`
- **CSS classes**: `.drawer-collapsed-tab` (vertical text tab on right edge)
- **Transition**: 0.3s cubic-bezier for width changes

### Tile

A chrome design: snap-to-grid layout with predefined slots. Shows collapsed
chips when minimised.

- **Identifiers**: `TileChrome`, `TileSlot` (`"right-third"`, `"right-half"`, `"bottom-half"`, `"bottom-right"`, `"center-large"`, `"top-right"`)
- **Files**: `src/ui/panel-chrome/TileChrome.tsx`, `src/ui/panel-chrome/types.ts`
- **CSS classes**: `.tile-layout-picker`, `.tile-layout-picker-item`, `.tile-collapsed-chip`
- **Transition**: 0.4s cubic-bezier for position/size changes

### Slot Picker

A popover inside tile chrome showing miniature preview thumbnails for choosing
a tile layout position.

- **Identifiers**: part of `TileChrome`
- **Files**: `src/ui/panel-chrome/TileChrome.tsx`
- **CSS classes**: `.tile-layout-picker`, `.tile-layout-picker-item`

### Geometry

Panel position, shape, and size.

- **Identifiers**: `Geometry` (`x`, `y`, `w`, `h`)
- **Files**: `src/ui/panel-chrome/types.ts`

### Chrome Mode

Panel visibility state: normal (visible), expanded (full-size), or collapsed
(minimised to tab/chip). Stores previous geometry for restoration.

- **Identifiers**: `ChromeMode` (`"normal"` | `"expanded"` | `"collapsed"`)
- **Files**: `src/ui/panel-chrome/types.ts`

### Design Selector

Devmode-only floating widget (bottom-left) for toggling between pane, drawer,
and tile chrome designs at runtime.

- **Identifiers**: `DesignSelector`, `mountDesignSelector()`
- **Files**: `src/ui/panel-chrome/DesignSelector.tsx`
- **CSS class**: `.design-selector`

### Title Bar

The draggable header of a panel chrome. Contains the panel title and close/expand
buttons.

- **Identifiers**: part of `PaneChrome`, `DrawerChrome`, `TileChrome`
- **CSS class**: `.panel-chrome-title-bar`

### Managed Panel

A wrapper component that integrates a panel with the overlay stack for
Escape-key and scroll-lock management.

- **Identifiers**: `ManagedPanel`
- **Files**: `src/ui/panel-chrome/`

### Pointer Drag

Reusable drag handler utility for window moves and resizes.

- **Identifiers**: `usePointerDrag`
- **Files**: `src/ui/panel-chrome/usePointerDrag.ts`

### Modal

A dialog overlay for alerts and confirmations. Imperative API. Supports plain
text and sanitised HTML content.

- **Identifiers**: `Modal`, `HtmlModal`, `mountModal()`, `showModal()`, `closeModal()`
- **Files**: `src/ui/Modal.tsx`, `src/ui/adapters/modal.tsx`
- **DOM mount**: `#solid-modal-root`
- **CSS classes**: `.modal`, `.modal-overlay`, `.modal-header`, `.modal-close`, `.modal-body`

### Picker Menu

An interactive menu for selecting values. Supports grid and vertical layouts
with keyboard/pointer navigation.

- **Identifiers**: `PickerMenu`, `mountPickerMenu()`, `showPickerMenu()`
- **Files**: `src/ui/PickerMenu.tsx`, `src/ui/adapters/picker-menu.tsx`
- **See also**: Hierarchical Picker Menu, Number Picker

### Hierarchical Picker Menu

A multi-level picker that transitions between categories, items, and optional
number entry. Used for structured code insertion.

- **Identifiers**: `HierarchicalPickerMenu`
- **Files**: `src/ui/HierarchicalPickerMenu.tsx`

### Number Picker

A special picker mode for numeric input with adjustable step and range.

- **Identifiers**: `NumberPickerMenu`
- **Files**: `src/ui/PickerMenu.tsx`

### Picker Entry

The data shape for a single item in a picker menu.

- **Identifiers**: `PickerEntry` (`label`, `value`, `insertText`, `special`)
- **Files**: `src/ui/PickerMenu.tsx`

### Picker Category

A named group of picker entries.

- **Identifiers**: `PickerCategory` (`label`, `id`, `items`)
- **Files**: `src/ui/HierarchicalPickerMenu.tsx`

### Picker Event

Custom event dispatched during picker interaction.

- **Identifiers**: `gamepadpickerinput` (custom event), directions (`up`, `down`, `left`, `right`), actions (`select`, `cancel`, `apply`)
- **Picker modes**: `replace`, `apply_call`, `apply_pre`, `apply`

### Radial Menu

A circular SVG-based pie menu with segments, pointer interaction, theming,
and a "locked segment" state.

- **Identifiers**: `RadialMenu`
- **Files**: `src/ui/RadialMenu.tsx`
- **CSS class**: `.radial-menu`, `.radial-menu-svg`

### Radial Theme

Theme specification for radial menus: inactive/active/locked fills, text colours,
hover overlays, and optional glow classes.

- **Identifiers**: `RadialTheme`
- **Files**: `src/ui/RadialMenu.tsx`

### Double Radial Picker

A two-stage radial menu (primary + context) for gamepad-driven hierarchical
selection.

- **Identifiers**: `DoubleRadialPicker`, `mountDoubleRadialMenu()`
- **Files**: `src/ui/DoubleRadialPicker.tsx`, `src/ui/adapters/double-radial-menu.tsx`

### Pie Radial Menu

A refined pie-chart radial menu with SVG wedge segments, a centre hub with
label/subtitle text, optional sub-menu arcs extending beyond the outer ring,
per-segment hints, and pointer interaction.

- **Identifiers**: `PieRadialMenu`, `PieRadialTheme`
- **Files**: `src/ui/PieRadialMenu.tsx`
- **See also**: Radial Menu, Double Pie Radial Picker

### Pie Radial Theme

Theme specification for PieRadialMenu: wedge fills (fill/hover/locked), stroke,
centre hub styling (fill, ring stroke/width), text colours (inactive, active,
centre, subtext), and optional glow CSS class.

- **Identifiers**: `PieRadialTheme`
- **Files**: `src/ui/PieRadialMenu.tsx`
- **See also**: Radial Theme

### Double Pie Radial Picker

A two-stage pie-based radial picker (primary categories + context items) for
gamepad-driven hierarchical selection, built on PieRadialMenu with left/right
stick controls and a status line beneath each wheel.

- **Identifiers**: `DoublePieRadialPicker`, `DoublePieRadialPickerProps`
- **Files**: `src/ui/DoublePieRadialPicker.tsx`
- **See also**: Pie Radial Menu, Double Radial Picker

### Geometry Utilities

SVG maths for radial menus: polar-to-Cartesian conversion, angle calculation
(0° = 12 o'clock), and arc path generation.

- **Identifiers**: `polarToCartesian()`, `getAngle()`, `describeArc()`
- **Files**: `src/utils/geometry.ts`
- **See also**: Radial Menu, Pie Radial Menu

### Toolbar

A control strip with action buttons.

- **Identifiers**: `MainToolbar`, `TransportToolbar`, `mountMainToolbar()`, `mountTransportToolbar()`
- **Files**: `src/ui/MainToolbar.tsx`, `src/ui/TransportToolbar.tsx`, `src/ui/adapters/toolbars.tsx`

### Transport Toolbar

The top toolbar with playback controls: Play, Pause, Stop, Rewind, Clear.
Buttons reflect the current transport state via CSS classes.

- **Identifiers**: `TransportToolbar`, `mountTransportToolbar()`
- **Files**: `src/ui/TransportToolbar.tsx`, `src/ui/adapters/toolbars.tsx`
- **DOM mount**: `#panel-top-toolbar`
- **State classes**: `transport-none` (red), `transport-wasm` (orange), `transport-both` (green), `transport-hardware` (warm off-green)

### Main Toolbar

The right-side utility toolbar: Connect, Graph, Load/Save Code, Font Size,
Help, Settings.

- **Identifiers**: `MainToolbar`, `mountMainToolbar()`
- **Files**: `src/ui/MainToolbar.tsx`, `src/ui/adapters/toolbars.tsx`
- **DOM mount**: `#panel-toolbar`

### Toolbar Row

A flex row container for logical grouping of toolbar buttons.

- **Identifiers**: part of toolbar components
- **CSS class**: `.toolbar-row`

### Toolbar Height

Dynamic CSS custom property tracking the transport toolbar height, used for
layout spacing below it.

- **Identifiers**: `--top-toolbar-height` (CSS custom property)

### Progress Bar

Horizontal transport progress indicator synced to the sibling toolbar-row
width. Non-interactive, rendered via `scaleX()` transform.

- **Identifiers**: `ProgressBar`
- **Files**: `src/ui/ProgressBar.tsx`

### Overlay

The stacked modal/dialog system. Manages Escape key handling and scroll lock
via a reference-counted LIFO stack.

- **Identifiers**: `pushOverlay()`, `popOverlay()`
- **Files**: `src/ui/overlayManager.ts`

### Overlay Entry

A single entry in the overlay stack, pairing an `id` with an `onEscape` callback.

- **Identifiers**: `OverlayEntry` (`id`, `onEscape`)
- **Files**: `src/ui/overlayManager.ts`
- **See also**: Overlay

### Scroll Lock

Reference-counted body overflow control that prevents page scroll when one or
more overlays are visible.

- **Identifiers**: part of overlay manager
- **Files**: `src/ui/overlayManager.ts`

### Adapter

An imperative mounting API that bridges Solid components into legacy code.
Replaces the former island architecture.

- **Identifiers**: `mount*()` functions
- **Files**: `src/ui/adapters/` (directory) — `modal.tsx`, `panels.tsx`, `picker-menu.tsx`, `double-radial-menu.tsx`, `toolbars.tsx`, `visualisationPanel.ts`
- **Pattern**: one adapter file per mountable component or group
- **Not**: "island" (deprecated), "bridge" (that's WASM-to-JS)

### Panel Controls

Centralised panel control handler registration. Allows late-binding so legacy
code can call panel operations without importing Solid directly. Now inlined
into `panels.tsx`.

- **Identifiers**: `panelControls`, `registerPanelControls()`
- **Files**: `src/ui/adapters/panels.tsx`
- **API**: `hideAllPanels()`, `toggleChromePanel(id)`, `showPanel(id)`, `hidePanel(id)`, `togglePanelVisibility(id)`

### Visualisation Panel Adapter

Adapter for the visualisation panel: registration, visibility checking, styling,
toggle functions.

- **Identifiers**: `toggleVisualisationPanel()`
- **Files**: `src/ui/adapters/visualisationPanel.ts`

### Tabs

Reusable tab navigation component with lazy content rendering and external
control via typed channels.

- **Identifiers**: `Tabs`, `Tab`
- **Files**: `src/ui/Tabs.tsx`
- **CSS classes**: `.panel-nav-bar`, `.panel-tab-button`, `.panel-tab-window`, `.panel-tab`

### Console

The message log panel showing log/warn/error/wasm output. Supports Markdown.

- **Identifiers**: `consoleStore`, `post()`, `ConsoleMessage`, `ConsoleMessageType` (`"log"` | `"warn"` | `"error"` | `"wasm"`)
- **Files**: `src/utils/consoleStore.ts`
- **Note**: Earlier documentation referred to `ConsoleEntry`/`ConsoleEntryType` — the actual identifiers are `ConsoleMessage`/`ConsoleMessageType`

---

## Help Panel

### Help Panel

Multi-tab container housing User Guide, ModuLisp Reference, Code Snippets, and
Keybindings tabs.

- **Identifiers**: `HelpPanel`, `mountHelpPanel()`
- **Files**: `src/ui/help/HelpPanel.tsx`, `src/ui/adapters/panels.tsx`
- **Keybinding**: Alt-h → `toggleHelp()`

### User Guide Tab

Experience-level-aware help content. Loads different HTML per selected level.
Persists selection to localStorage.

- **Identifiers**: `UserGuideTab`
- **Files**: `src/ui/help/UserGuideTab.tsx`
- **See also**: Experience Level

### Experience Level

Three-level toggle (beginner / intermediate / advanced) controlling help content
depth.

- **Identifiers**: `ExperienceLevelSelector`
- **Files**: `src/ui/help/UserGuideTab.tsx`

### ModuLisp Reference Tab

Function reference browser with version filtering, tag filtering, starred
favourites, and expandable entries.

- **Identifiers**: `ModuLispReferenceTab`
- **Files**: `src/ui/help/ModuLispReferenceTab.tsx`
- **See also**: Reference Entry, Reference Filters, Reference Search

### Reference Entry

A single function/builtin in the ModuLisp reference: name, aliases, tags,
parameters, examples, and version metadata.

- **Identifiers**: `ReferenceEntry`
- **Files**: `src/utils/referenceStore.ts`

### Reference Filters

Firmware version dropdown and tag filter controls for narrowing the reference
display.

- **Identifiers**: `ReferenceFilters`
- **Files**: `src/ui/help/ReferenceFilters.tsx`

### Reference Search

Alt-F symbol lookup: finds the word at cursor, opens the help panel to the
reference tab, and auto-expands the matching entry.

- **Identifiers**: `showDocumentationForSymbol()` (keymap action), reference search typed channel
- **Files**: `src/editors/keymaps.ts`, `src/ui/help/ModuLispReferenceTab.tsx`

### Reference Toast

Auto-dismissing transient notification (2500ms default) for reference search
feedback (e.g. "No match found").

- **Identifiers**: part of `ModuLispReferenceTab`
- **Files**: `src/ui/help/ModuLispReferenceTab.tsx`

### Code Snippets Tab

Snippet browser with search, tagging, favouriting, and inline code preview.

- **Identifiers**: `CodeSnippetsTab`
- **Files**: `src/ui/help/CodeSnippetsTab.tsx`

### Snippet Modal

Modal for creating/editing snippets: title, tags (comma-separated), and an
embedded CodeMirror editor.

- **Identifiers**: `SnippetModal`
- **Files**: `src/ui/help/SnippetModal.tsx`

### CodeMirror Editor (embedded)

A lightweight CodeMirror instance used inside snippet modals and theme previews.
Read-only variant exists for theme preview cards.

- **Identifiers**: `CodeMirrorEditor`
- **Files**: `src/ui/help/CodeMirrorEditor.tsx`
- **Uses**: `exampleEditorExtensions` for read-only instances

### Keybindings Tab

Platform-aware keybinding display. Translates Mod → Cmd/Ctrl and Alt → Option
based on OS family selection.

- **Identifiers**: `KeybindingsTab`
- **Files**: `src/ui/help/KeybindingsTab.tsx`

---

## Settings Panel

### Settings Panel

Multi-tab settings hub with General and Themes tabs.

- **Identifiers**: `SettingsPanel`, `mountSettingsPanel()`
- **Files**: `src/ui/settings/SettingsPanel.tsx`, `src/ui/adapters/panels.tsx`

### General Settings

Aggregates all non-theme setting sub-sections into a single scrollable view.

- **Identifiers**: `GeneralSettings`
- **Files**: `src/ui/settings/GeneralSettings.tsx`
- **Sub-sections**: PersonalSettings, EditorSettings, StorageSettings, UISettings, VisualisationSettings, AdvancedSettings, ConfigurationManagement

### Theme Settings

Theme gallery with live preview cards. Each card shows sample code in the
theme's colours. Click to apply.

- **Identifiers**: `ThemeSettings`
- **Files**: `src/ui/settings/ThemeSettings.tsx`
- **See also**: Theme (editor section), CodeMirror Editor (embedded)

### Configuration Management

Devmode-only export/import for the full configuration as JSON. Uses File System
Access API or download fallback.

- **Identifiers**: `ConfigurationManagement`
- **Files**: `src/ui/settings/ConfigurationManagement.tsx`

### Form Controls

Reusable setting control primitives used throughout the settings panel.

- **Identifiers**: `Section`, `FormRow`, `TextInput`, `NumberInput`, `Checkbox`, `Select`, `RangeInput`, `PanelButton`
- **Files**: `src/ui/settings/FormControls.tsx`
- **CSS classes**: `.panel-section`, `.panel-section-title`, `.panel-row`, `.panel-label`, `.panel-control`, `.panel-button`

---

## Visualisation

**Spelling**: Always "visualisation" (British). Legacy code may use "visualization"
or the abbreviation "serialVis" — these should be normalised over time.

### Visualisation

The waveform rendering system that displays real-time channel data.

- **Identifiers**: `VisualisationSession`, `VisualisationState`, `visualisationStore`, `visStore`, `VisualisationSettings`
- **Files**: `src/utils/visualisationStore.ts`, `src/contracts/visualisationEvents.ts`
- **Legacy aliases** (to be normalised): `serialVis`, `SerialVis`, `serial-vis`
- **Not**: "viz" (informal), "graph" (misleading)

### Visualisation Session

The current snapshot of visualisation state: time, settings, expressions, bar,
palette.

- **Identifiers**: `VisualisationSession` (public API type alias), `VisualisationState` (internal)
- **Files**: `src/utils/visualisationStore.ts`

### Serial Vis (component)

The high-performance canvas-based waveform renderer. Renders analogue channels
as continuous lines and digital channels as step-mode lanes.

- **Identifiers**: `SerialVis`
- **Files**: `src/ui/SerialVis.tsx`, `src/ui/visualisation/serialVis.ts`
- **DOM element**: `#serialcanvas`
- **Note**: name is legacy — prefer "visualisation" in new code

### Internal Vis

Dual-canvas visualisation (plot + timeline) with Catmull-Rom interpolation for
smooth rendering.

- **Identifiers**: `InternalVis`
- **Files**: `src/ui/InternalVis.tsx`

### Vis Legend

Channel indicator showing active expressions, colours, and labels. Inactive
channels shown at reduced opacity.

- **Identifiers**: `VisLegend`
- **Files**: `src/ui/VisLegend.tsx`
- **CSS classes**: `.vis-legend`, `.vis-legend-entry`, `.vis-legend-swatch`

### Vis Sample

A time/value tuple used for plotting.

- **Identifiers**: `VisualisationSample` (`{time, value}`)
- **Files**: `src/utils/visualisationStore.ts`

### Serial Buffer Snapshot

Raw circular buffer data for serial streams.

- **Identifiers**: `SerialBufferSnapshot` (channels array + lengths)
- **Files**: `src/utils/visualisationStore.ts`

### Palette

The colour set used for visualisation waveforms. Switches based on light/dark
theme variant.

- **Identifiers**: `setSerialVisPalette()`
- **Files**: `src/editors/themes/themeManager.ts`
- **Event**: `SERIAL_VIS_PALETTE_EVENT` / `useq-serialvis-palette-changed`

### Visualisation Controller

Legacy canvas rendering orchestrator for the serial visualisation.

- **Identifiers**: `visualisationController`
- **Files**: `src/ui/visualisation/visualisationController.ts`

---

## Editor & CodeMirror

The code editor is CodeMirror 6. Extensions live in `src/editors/extensions/`
and canonical state (compartments, store) lives in `src/lib/`.

### Editor

The CodeMirror `EditorView` instance. Accessed through a Solid signal.

- **Identifiers**: `editor` (signal), `setEditor()`, `editorSession`, `getEditorContent()`, `setEditorContent()`, `insertEditorText()`, `applyEditorFontSize()`
- **Files**: `src/lib/editorStore.ts`
- **DOM mount**: `#panel-main-editor`
- **Not**: "code editor" (redundant), "CM" (too terse)

### Compartment

A CodeMirror reconfiguration slot — allows dynamic swapping of extensions
(e.g. theme, font size) without rebuilding the full editor state.

- **Identifiers**: `themeCompartment`, `fontSizeCompartment`
- **Files**: `src/lib/editorCompartments.ts` (canonical), `src/editors/state.ts` (re-export)

### Extension

A CodeMirror plugin or behaviour added to the editor. Grouped into bundles.

- **Identifiers**: `baseExtensions`, `themeExtensions`, `functionalExtensions`, `mainEditorExtensions`, `exampleEditorExtensions`
- **Files**: `src/editors/extensions.ts`
- **`themeExtensions`**: theme compartment + font size compartment + lineNumbers + bracketMatching
- **`functionalExtensions`**: history + foldGutter + drawSelection + updateListener
- **`baseExtensions`**: core + theme + clojure-mode + structure + evalHighlight + visReadability

### Eval Highlight

The flash decoration shown when code is evaluated. Yellow for normal eval,
cyan for soft/preview eval. Clears after 1 second.

- **Identifiers**: `evalHighlightField` (StateField), `evalHighlightEffect` (StateEffect), `evalHighlightDeco`, `evalPreviewHighlightDeco`, `flashEvalHighlight()`
- **CSS classes**: `.cm-evaluated-code`, `.cm-evaluated-preview`
- **Animations**: `flash-highlight`, `flash-highlight-preview`
- **Files**: `src/editors/extensions/evalHighlight.ts`, `src/ui/styles/editor.css`
- **See also**: Eval Request

### Soft Eval

A preview evaluation that shows what *would* be evaluated without committing it.
Uses a distinct highlight colour.

- **Identifiers**: `softEval()` (keymap action), `isPreview` (flag in evalHighlightEffect payload)
- **Files**: `src/editors/keymaps.ts`
- **Keybinding**: Mod-Shift-Enter
- **See also**: Eval Highlight

### Quantised Eval

Evaluation scheduled to fire on the next bar boundary rather than immediately.

- **Identifiers**: `evalQuantised()` (keymap action)
- **Files**: `src/editors/keymaps.ts`
- **Keybinding**: Alt-Enter

### Immediate Eval

A code evaluation prefixed with `@` that runs through WASM and prints the result
to the console, rather than sending to hardware. Used for quick inspection.

- **Identifiers**: `@` prefix handling in `evalNow()`
- **Files**: `src/editors/editorConfig.ts`
- **See also**: Eval Request, WASM

### Expression Gutter

The vertical coloured lines in the gutter showing which expression ranges
map to which output channels. Optional play buttons trigger evaluation or
visualisation of individual expressions.

- **Identifiers**: `expressionGutter` (gutter instance), `expressionGutterField` (StateField), `ExpressionGutterMarker` (GutterMarker subclass), `expressionGutterEnabled` (UISettings)
- **CSS class**: `.cm-expression-gutter`
- **Marker properties**: `color`, `isStart`, `isEnd`, `isMid`, `isActive`, `exprType`, `showPlayButton`, `isVisualised`
- **Files**: `src/editors/extensions/structure.ts`
- **See also**: Expression, Play Button

### Play Button

The ▶ button in the expression gutter that evaluates or visualises a single
expression. Visibility controlled by `expressionClearButtonEnabled` setting.

- **Identifiers**: `showPlayButton` (marker property), `expressionClearClickPlugin` (ViewPlugin), `handlePlayExpression()`, `handleVisualiseExpression()`
- **CSS classes**: `.cm-expr-play-btn`, `.cm-expr-play-btn.is-visualising`
- **Files**: `src/editors/extensions/structure.ts`, `src/ui/styles/editor.css`

### Expression Tracking

Tracking which expressions in the document correspond to output channels
(`a1`–`a8`, `d1`–`d8`, `s1`–`s8`). The gutter and visualisation use this to
colour-code and provide per-expression controls.

- **Identifiers**: `lastEvaluatedExpressionField` (StateField), `expressionEvaluatedAnnotation` (Annotation), `detectAndTrackExpressionEvaluation()`, `findExpressionBounds()`, `findExpressionDefinition()`, `isRangeActive()`, `createMarkersForRange()`, `processExpressionRanges()`, `buildMarkers()`
- **Pattern regex**: `/\b([ads])([1-8])(?=[\s)(]|$)/g`
- **Files**: `src/editors/extensions/structure.ts`

### Node Highlight

Decorations showing the current syntax node and its parent container.
Used during structural navigation.

- **Identifiers**: `nodeHighlightField` (StateField)
- **CSS classes**: `.cm-current-node`, `.cm-parent-node`, `.cm-parent-node-editor-area`, `.cm-left-sibling-underscore`, `.cm-right-sibling-underscore`
- **Files**: `src/editors/extensions/structure.ts`, `src/ui/styles/editor.css`
- **See also**: Structural Navigation

### Structural Navigation

Tree-based movement through Lisp S-expressions. Navigates by syntax structure
rather than characters or words.

- **Identifiers**: `navigateIn()`, `navigateOut()`, `navigateNext()`, `navigatePrev()`, `navigateRight()`, `navigateLeft()`, `navigateUp()`, `navigateDown()`, `navigationMetaField` (StateField), `navigationMetaEffect` (StateEffect)
- **Files**: `src/editors/extensions/structure/new-structure.ts`
- **Helpers**: `findNodeAt()`, `isContainerNode()`, `isStructuralToken()`, `createStructuralEditor()`
- **See also**: Node Highlight

### Structural Editing

Operations that edit code by syntax tree structure rather than raw text:
slurp, barf, cut/paste expression, wrap in function, move.

- **Identifiers**: `slurpForward()`, `slurpBackward()`, `barfForward()`, `barfBackward()`, `wrapInFunction()`
- **Files**: `src/editors/extensions/structure/new-structure.ts`
- **See also**: Structural Navigation

### Slurp

Structural edit that absorbs the next (or previous) sibling into the current
container, growing its bounds.

- **Identifiers**: `slurpForward()`, `slurpBackward()`
- **Files**: `src/editors/extensions/structure/new-structure.ts`
- **See also**: Barf, Structural Editing

### Barf

Structural edit that expels the last (or first) child from the current
container, shrinking its bounds.

- **Identifiers**: `barfForward()`, `barfBackward()`
- **Files**: `src/editors/extensions/structure/new-structure.ts`
- **See also**: Slurp, Structural Editing

### Traversal Stack

Navigation metadata recording which nodes were traversed during structural
navigation, enabling smart re-entry after ascending to a parent.

- **Identifiers**: `TraversalStack`, `NavigationMeta`, `navigationMetaField`
- **Files**: `src/editors/extensions/structure/new-structure.ts`
- **See also**: Structural Navigation

### Expression Bounds

The line-number range and character positions of the S-expression containing
a matched channel pattern (e.g. `a1`, `d2`). Used by the gutter and
visualisation to colour-code and provide per-expression controls.

- **Identifiers**: `ExpressionBounds`, `findExpressionBounds()`, `findExpressionDefinition()`
- **Files**: `src/editors/extensions/structure.ts`
- **See also**: Expression Gutter, Expression Tracking

### Vis Readability

An SVG polygon backdrop rendered behind editor text when the serial visualisation
canvas is visible underneath. Ensures text remains readable over waveforms.

- **Identifiers**: `visReadabilityPlugin` (ViewPlugin), `VisReadabilityPlugin` (class)
- **Helpers**: `getLineContentBounds()`, `groupIntoBlocks()`, `buildBlockPolygonPath()`
- **Files**: `src/editors/extensions/visReadability.ts`

### Keymap

A set of key bindings for the editor. Multiple keymaps are composed together.

- **Identifiers**: `useq_keymap` (uSEQ-specific bindings), `completeClojureKeymap` (paredit/structural editing), `structural_navigation_keymap` (tree nav, currently commented out), `baseKeymap`, `mainEditorKeymap`
- **Files**: `src/editors/keymaps.ts`
- **Key eval bindings**: Mod-Enter → `evalNow()`, Alt-Enter → `evalQuantised()`, Mod-Shift-Enter → `softEval()`
- **Key UI bindings**: Alt-h → `toggleHelp()`, Alt-g → `toggleSerialVis()`, Alt-f → `showDocumentationForSymbol()`

### Theme

A CodeMirror visual theme. Managed via compartment for live switching.
Theme changes also sync root CSS variables for non-editor UI.

- **Identifiers**: `setTheme()`, `setMainEditorTheme()`, `adjustPanelsToTheme()`, `setSerialVisPalette()`, `editorBaseTheme`
- **Files**: `src/editors/themes/themeManager.ts`, `src/editors/themes/builtinThemes.ts`
- **Built-in themes**: `useq-dark`, `uSEQ-1337`, `amy`, `ayu-light`, `bespin`, `birds-of-paradise`, `clouds`, `cobalt`, `cool-glow`, `dracula`, `espresso`, `noctis-lilac`, `rose-pine-dawn`, `solarized-light`, `smoothy`, `tomorrow`
- **Base theme CSS**: `.cm-content`, `.cm-cursor`, `.cm-gutters`, `.cm-matchingBracket`, `.cm-scroller`
- **See also**: Compartment

### Theme Recipe

A declarative theme specification combining a name, light/dark variant, colour
settings (background, foreground, caret, selection, etc.), and syntax highlight
styles. Used by `createTheme()` to produce a CodeMirror theme extension.

- **Identifiers**: `ThemeRecipe`, `ThemeVariant` (`"light"` | `"dark"`), `ThemeSettings`
- **Files**: `src/editors/themes/createTheme.ts`
- **See also**: Theme

### Editor Base Theme

The non-swappable base CodeMirror theme providing layout, cursor, line height,
font, and gutter scaffolding styles. Always active regardless of selected theme.

- **Identifiers**: `editorBaseTheme`
- **Files**: `src/editors/themes/builtinThemes.ts`
- **See also**: Theme, Compartment

### Block Polygon

An SVG staircase-shaped polygon hugging a group of consecutive lines' content
bounds, providing contrast behind editor text when the visualisation canvas is
visible underneath.

- **Identifiers**: `buildBlockPolygonPath()`, `groupIntoBlocks()`, `getLineContentBounds()`, `PixelLineBounds`
- **Files**: `src/editors/extensions/visReadability.ts`
- **See also**: Vis Readability

### Clojure Mode

The syntax highlighting and paredit support for Lisp/Clojure, provided by
`@nextjournal/clojure-mode`.

- **Identifiers**: `default_clojure_extensions`
- **Files**: `src/editors/extensions.ts`
- **Not**: "Lisp mode" (the package is Clojure-specific)
- **See also**: ModuLisp

### Autosave

Interval-based persistence of editor contents to localStorage.

- **Identifiers**: `autoSaveEnabled`, `autoSaveInterval` (in `StorageSettings`)
- **Files**: `src/lib/appSettings.ts`, `src/runtime/bootstrap.ts`

---

## WASM

### WASM

The WebAssembly build of the ModuLisp interpreter, compiled via Emscripten.
Enables in-browser code execution without hardware.

- **Identifiers**: `wasm`, `Wasm` prefix, `public/wasm/` (build output)
- **Files**: `src/runtime/wasmInterpreter.ts`
- **See also**: ModuLisp, No-Module Mode

### WASM ABI

The contract defining which C symbols the editor expects from the WASM module.

- **Identifiers**: `WasmAbiValidation`, `validateWasmAbi()`, `assertWasmAbi()`, `REQUIRED_WASM_EXPORTS`, `OPTIONAL_WASM_EXPORTS`
- **Files**: `src/contracts/wasmAbi.ts`

### WASM Export

A C function symbol exposed to JavaScript via Emscripten.

- **Required**: `useq_init`, `useq_eval`, `useq_update_time`, `useq_eval_output`
- **Optional**: probed at startup, degraded gracefully if absent
- **Files**: `src/contracts/wasmAbi.ts`

### Heap Helper

Emscripten memory management functions needed for batch operations.

- **Identifiers**: `_malloc`, `_free`, `REQUIRED_HEAP_HELPERS`
- **Files**: `src/contracts/wasmAbi.ts`

### Bridge

The WASM-to-JS interface layer.

- **Identifiers**: `bridge` (in test files), `cwrap`, `CwrapDescriptor`
- **Files**: `src/contracts/wasmAbi.ts`, `src/lib/bridge.test.ts`
- **Not**: "adapter" (that's UI mounting)

### WASM Runtime Port

Typed interface exposing the WASM interpreter to the rest of the application:
capabilities check, eval, transport state sync, time update, and batch output
evaluation.

- **Identifiers**: `WasmRuntimePort`, `wasmRuntimePort`, `WasmCapabilities` (`enabled`, `supportsEval`, `supportsTimeWindow`)
- **Files**: `src/runtime/wasmInterpreter.ts`
- **See also**: WASM, Bridge

### Time Sample

A single time-series data point `{time, value}` produced by WASM output
evaluation. Used to build visualisation waveforms.

- **Identifiers**: `TimeSample`, `SampleSeriesMap` (`Map<string, TimeSample[]>`)
- **Files**: `src/runtime/wasmInterpreter.ts`
- **See also**: Vis Sample, Visualisation

### No-Module Mode

WASM-only execution without hardware. Triggered by user setting or missing WebSerial.

- **Identifiers**: `noModuleMode`, `startLocallyWithoutHardware`
- **Files**: `src/runtime/bootstrap.ts`
- **See also**: Connection Mode `"browser"`

---

## Gamepad

### Gamepad

Browser Gamepad API integration for controller-driven interaction.

- **Identifiers**: `GamepadManager`, `GamepadSnapshot`
- **Files**: `src/editors/gamepadControl.ts`

### Gamepad Controller

High-level controller mapping gamepad buttons/sticks to editor and menu
operations. Manages modes: normal, picker, number-picker, loading-picker.

- **Identifiers**: `GamepadController`
- **Files**: `src/editors/gamepadControl.ts`
- **Navigation modes**: spatial (arrow keys), structural (prev/next)

### Button Map

Mapping from gamepad button indices to named actions.

- **Identifiers**: `BUTTON_MAP`, `ButtonMapType`, `ButtonState`
- **Files**: `src/editors/gamepadControl.ts`
- **Buttons**: A, B, X, Y, LB, RB, LT, RT, Back, Start, LeftStickPress, RightStickPress, Up, Down, Left, Right

### Axis Map

Mapping from gamepad axis indices to named axes.

- **Identifiers**: `AXIS_MAP`, `AxisMapType` (`LeftStickX`, `LeftStickY`, `RightStickX`, `RightStickY`)
- **Files**: `src/editors/gamepadControl.ts`
- **Deadzone**: 0.1

### Manual Control Binding

Mapping from a gamepad stick to a numeric value in the editor. Enables
real-time control of expression parameters via sticks.

- **Identifiers**: `ManualControlBinding` (`stick`, `slot`, `from`, `to`, `value`, `originalText`), `mapManualControlBindingsThroughChanges()`
- **Files**: `src/editors/manualControlState.ts`
- **Update rate**: ~30Hz via `sendSerialInputStreamValue()`

### Controller Mode

The current operating mode of the gamepad controller, determining how button
presses are interpreted.

- **Identifiers**: `ControllerMode` (`"normal"`, `"picker"`, `"number-picker"`, `"loading-picker"`)
- **Files**: `src/editors/gamepadControl.ts`
- **See also**: Gamepad Controller, Picker Style

### Navigation Mode

Whether gamepad D-pad navigation moves spatially (arrow keys) or structurally
(prev/next through syntax tree nodes).

- **Identifiers**: `NavigationMode` (`"spatial"`, `"structural"`)
- **Files**: `src/editors/gamepadControl.ts`
- **See also**: Structural Navigation, Gamepad Controller

### Picker Style

The UI mode for gamepad-driven menu selection.

- **Identifiers**: `gamepadPickerStyle` (`"grid"` | `"radial"`)
- **Files**: `src/lib/appSettings.ts`
- **Defined in**: `UISettings`

---

## Events

All custom DOM events use the `useq-` prefix.

- **Files**: `src/contracts/runtimeEvents.ts`, `src/contracts/visualisationEvents.ts`

### Connection Changed

Fired when hardware connects/disconnects or protocol mode changes.

- **Identifiers**: `CONNECTION_CHANGED_EVENT`, `useq-connection-changed`

### Protocol Ready

Fired after successful JSON handshake.

- **Identifiers**: `PROTOCOL_READY_EVENT`, `useq-protocol-ready`

### Code Evaluated

Fired after code is sent for evaluation.

- **Identifiers**: `CODE_EVALUATED_EVENT`, `useq-code-evaluated`

### Visualisation Changed

Fired when visualisation state updates (time, expressions, bar).

- **Identifiers**: `VISUALISATION_SESSION_EVENT`, `useq-visualisation-changed`

### Serial Vis Palette Changed

Fired when the waveform colour palette changes.

- **Identifiers**: `SERIAL_VIS_PALETTE_EVENT`, `useq-serialvis-palette-changed`

### Serial Vis Auto Open

Fired to request automatic visualisation panel opening.

- **Identifiers**: `SERIAL_VIS_AUTO_OPEN_EVENT`, `useq-serialvis-auto-open`

### Animate Connect

Visual feedback for a connection attempt.

- **Identifiers**: `ANIMATE_CONNECT_EVENT`, `useq-animate-connect`

### Device Plugged In

USB device physically connected.

- **Identifiers**: `DEVICE_PLUGGED_IN_EVENT`, `useq-device-plugged-in`

### JSON Meta

Fired when a protocol response contains a `meta` field.

- **Identifiers**: `JSON_META_EVENT`, `useq-json-meta`

### Bootstrap Failure

Fired on startup/initialisation failure.

- **Identifiers**: `BOOTSTRAP_FAILURE_EVENT`, `useq-bootstrap-failure`

### Runtime Diagnostics

Diagnostics snapshot (protocol mode, capabilities, etc.).

- **Identifiers**: `RUNTIME_DIAGNOSTICS_EVENT`, `useq-runtime-diagnostics`

---

## Build & Bundling

### Asset

Generated files (WASM bundle, themes, etc.) produced by build scripts.

- **Identifiers**: `build:assets` (npm script)
- **Files**: `public/assets/`, `public/wasm/`

### Bundle

The single Vite output replacing per-island builds.

- **Identifiers**: `bundle.js`, `bundle.css`
- **Files**: `public/solid-dist/`, `vite.config.ts`
- **Not**: "island bundle" (deprecated pattern)

### Dev-Mode Component Labels

Custom Babel plugin injecting `data-component` and `data-source` attributes on
root DOM elements during dev builds. Stripped in production.

- **Identifiers**: `data-component`, `data-source`
- **Files**: `plugins/babel-solid-label.cjs`, `plugins/vitest.config.js`

---

## DOM Layout

Key DOM element IDs forming the application shell.

| ID | Purpose | Mount target |
|---|---|---|
| `#panel-main-editor` | CodeMirror editor container | Editor |
| `#panel-vis` | Serial visualisation panel | Canvas |
| `#panel-top-toolbar` | Transport toolbar mount | TransportToolbar |
| `#panel-toolbar` | Main toolbar mount | MainToolbar |
| `#panel-aux` | Auxiliary panels | Notifications, guides |
| `#serialcanvas` | Canvas element for waveforms | Serial Vis |
| `#status-bar` | Status bar | Status display |
| `#solid-modal-root` | Modal root container | Modal adapter |

- **Files**: `public/index.html`

---

## CSS Custom Properties

Theme-driven CSS variables set on `:root` by `adjustPanelsToTheme()`.

| Property | Purpose |
|---|---|
| `--accent-color` | Primary brand/action colour |
| `--accent-color-hover` | Accent hover state |
| `--accent-color-active` | Accent active/pressed state |
| `--text-primary` | Primary text colour |
| `--text-secondary` | Secondary/muted text |
| `--panel-bg` | Panel background |
| `--panel-border` | Panel border colour |
| `--panel-border-radius` | Panel corner radius |
| `--toolbar-bg` | Toolbar background |
| `--panel-control-bg` | Form control background |
| `--panel-item-hover-bg` | List item hover |
| `--panel-item-active-bg` | List item active/selected |
| `--panel-section-bg` | Section background |
| `--code-font` | Monospace font stack |
| `--top-toolbar-height` | Dynamic transport toolbar height |

- **Files**: `src/editors/themes/themeManager.ts`, `src/ui/styles/`

### WebSocket Server

Dev-mode WebSocket server (default port 8082) for external tool integration.

- **Identifiers**: `startWebSocketServer()`, `stopWebSocketServer()`, `getWebSocketServer()`, `isWebSocketServerRunning()`
- **Files**: `src/effects/devmodeWebSocketServer.ts`

### Config Server

Dev-only WebSocket server (port 8081) that receives save/load requests from the
webapp and writes config files to the source tree during development.

- **Identifiers**: `config-server` (npm script)
- **Files**: `scripts/config-server.mjs`
- **See also**: AppSettings, Configuration Management

### Typecheck Boundary

The explicit `include` list in `tsconfig.json` defining which source directories
are eligible for `tsc --noEmit`. Legacy code is excluded.

- **Identifiers**: `include` (in `tsconfig.json`)
- **Files**: `tsconfig.json`
- **Shims**: `vitest.shims.d.ts`, `src/types/web-serial.d.ts`

### Contract Tests

A targeted Vitest run covering `src/contracts/`, `src/runtime/`, and selected
legacy integration files. Verifies ABI contracts, event schemas, and runtime
invariants.

- **Identifiers**: `test:contracts` (npm script)
- **Files**: `package.json`
- **See also**: WASM ABI, Runtime Contract, Typed Event Bus

---

## Legacy & Deprecated Terms

Terms that should not be used in new code. Listed here so agents know to
avoid them and can recognise them in old code.

| Deprecated term | Replacement | Notes |
|---|---|---|
| `src/islands/` | `src/ui/adapters/` | Per-component Astro island pattern, eliminated |
| `src-solid/` | `src/ui/` | Old Solid component directory, removed |
| `useqedit` | `useq-perform` | Legacy Python editor |
| `serialComms` | `src/transport/` | Real implementation moved |
| `mockTimeGenerator` | `src/effects/localClock.ts` | Modern version |
| `"useqcode"` (storage key) | `"uSEQ-Perform-User-Code"` | Legacy localStorage key |
| `"editorConfig"` (storage key) | `"uSEQ-Perform-User-Settings"` | Legacy localStorage key |
| `"useqConfig"` (storage key) | `"uSEQ-Perform-User-Settings"` | Legacy localStorage key |
| `serialVis` / `serial-vis` | `visualisation` | Abbreviation, to be normalised |
| `visualization` (US spelling) | `visualisation` | British spelling is canonical |
| `window.__*` bridge APIs | `src/ui/adapters/` imports | Old global bridge pattern |

---

## Naming Conventions

| Pattern | Convention | Example |
|---|---|---|
| DOM event names | `useq-` prefix, kebab-case | `useq-connection-changed` |
| Event constants | `SCREAMING_SNAKE_CASE` | `CONNECTION_CHANGED_EVENT` |
| Type suffixes | `*Detail` (event payload), `*Snapshot` (immutable), `*Settings` (config), `*Session` (runtime state) | `RuntimeSessionSnapshot`, `EditorSettings` |
| Adapter functions | `mount*()`, `show*()`, `close*()`, `toggle*()` | `mountModal()`, `showPickerMenu()` |
| Overlay stack | `push*()` / `pop*()` | `pushOverlay()`, `popOverlay()` |
| Store files | `*Store.ts` | `consoleStore.ts`, `settingsStore.ts` |
| Repository files | `*Repository.ts` | `appSettingsRepository.ts` |
| Machine files | `*.machine.ts` | `transport.machine.ts` |
| Effect files | named by concern | `transport.ts`, `editor.ts`, `ui.ts` |
| Spelling | British English | `visualisation`, `analogue`, `colour`, `initialise` |
| Panel CSS classes | `.panel-*` | `.panel-chrome`, `.panel-section`, `.panel-button` |
| Chrome button CSS | `.chrome-btn` | 20×20px icon buttons in title bars |
| Form control CSS | `.panel-*` prefix | `.panel-row`, `.panel-label`, `.panel-control` |
| Event detail types | `*Detail` | `ConnectionChangedDetail`, `CodeEvaluatedDetail` |
| Config types | `*Document`, `*Patch` | `AppConfigDocument`, `AppSettingsPatch` |
| Contract assertions | `assert*Contract()` | `assertEditorRuntimeContract()`, `assertWasmAbiContract()` |
| Port interfaces | `*Port` | `WasmRuntimePort` (typed capability interface) |
