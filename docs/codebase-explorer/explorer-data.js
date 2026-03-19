// ============================================================
// CONSTANTS & SHARED DATA
// ============================================================

export const LAYER_COLORS = {
  contracts: '#f97583',
  lib: '#b392f0',
  machines: '#79c0ff',
  runtime: '#56d364',
  effects: '#d2a8ff',
  transport: '#58a6ff',
  utils: '#ffa657',
  ui: '#ff7b72',
  legacy: '#8b949e'
};

export const LAYER_ORDER = ['contracts', 'lib', 'machines', 'runtime', 'effects', 'transport', 'utils', 'ui', 'legacy'];

export const LAYER_RANK = {
  contracts: 0,
  lib: 1,
  machines: 2,
  runtime: 3,
  effects: 4,
  transport: 4,
  utils: 3,
  ui: 5,
  legacy: 6
};

export const MODULE_DESC = {
  'contracts/runtimeEvents': 'Typed CustomEvent contract for runtime lifecycle events (connection, protocol, diagnostics)',
  'contracts/useqRuntimeContract': 'Command vocabulary shared between editor and runtime (play/pause/stop/etc)',
  'contracts/visualisationEvents': 'Typed CustomEvent contract for visualisation data flow',
  'contracts/wasmAbi': 'WASM ABI contract: required/optional C symbols, validation, assertions',
  'lib/appSettings': 'Canonical settings schema, defaults, normalization, persistence, migration',
  'lib/CircularBuffer': 'Generic fixed-capacity ring buffer for time-series data',
  'lib/debug': 'Module-level debug flag with conditional logging',
  'lib/editorCompartments': 'CodeMirror Compartments for runtime-reconfigurable extensions (theme, font)',
  'lib/editorDefaults': 'Static constants: default font size, theme, starting code',
  'lib/editorStore': 'Canonical Solid signal for active CodeMirror EditorView instance',
  'lib/effectResource': 'Bridge: Effect library async computations as Solid reactive resources',
  'lib/typedChannel': 'Lightweight typed pub/sub channel (replaces CustomEvent coupling)',
  'lib/useActorSignal': 'Solid hook bridging XState actor state to reactive signal',
  'machines/transport.machine': 'XState v5 state machine: playing/paused/stopped transport states',
  'runtime/appSettingsRepository': 'Singleton settings repository: read/write/subscribe, connects to runtime',
  'runtime/bootstrap': 'Single public entry point for app startup (6-step sequence)',
  'runtime/bootstrapPlan': 'Pure decision function: determines startup mode',
  'runtime/configSchema': 'Config document validation, merging, diff utilities',
  'runtime/jsonProtocol': 'Pure data types and builders for JSON serial protocol (fw >= 1.2.0)',
  'runtime/legacyRuntimeAdapter': 'Adapts legacy transport into typed LegacyRuntimeAdapter interface',
  'runtime/runtimeDiagnostics': 'Maintains and broadcasts diagnostic snapshot via CustomEvents',
  'runtime/runtimeService': 'Sole owner of runtime session state mutation, coordinates all layers',
  'runtime/runtimeSession': 'Pure computation of runtime session state from inputs',
  'runtime/runtimeSessionStore': 'Singleton store for runtime session state',
  'runtime/startupContext': 'Singleton for startup flags and environment capabilities',
  'runtime/urlParams': 'Parses URL search params into StartupFlags, applies side effects',
  'effects/editor': 'Editor side-effects: font size, file load/save via File System API',
  'effects/mockTimeGenerator': 'rAF-based mock time loop for WASM-only visualisation',
  'effects/transport': 'Thin facade over runtimeService for transport operations',
  'effects/transportClock': 'Mock-time clock policy based on transport state transitions',
  'effects/transportOrchestrator': 'Wires all transport subsystems: XState actor + effects + events',
  'effects/ui': 'UI-level effects: connection toggle, panel visibility, graph toggle',
  'transport/connector': 'Serial port lifecycle manager, owns SerialPort reference',
  'transport/json-protocol': 'JSON protocol driver: negotiation, request/response, heartbeat',
  'transport/legacy-text-protocol': 'Legacy plain-text serial protocol driver',
  'transport/serial-utils': 'Pure byte manipulation, port validation, signal smoothing utilities',
  'transport/stream-parser': 'Byte-level framing and message routing from Web Serial stream',
  'transport/types': 'Shared transport type definitions and wire-level constants',
  'transport/upgradeCheck': 'Firmware version parser, stores currentVersion',
  'utils/consoleStore': 'Reactive in-memory console message log (SolidJS store, 1000 msg cap)',
  'utils/settingsStore': 'SolidJS reactive mirror of appSettingsRepository',
  'utils/visualisationStore': 'Reactive store for all visualisation state (expressions, buffers, palette)',
  'utils/referenceStore': 'Reactive store for ModuLisp reference UI state (starred, expanded)',
  'utils/snippetStore': 'Reactive store for user code snippets (localStorage persisted)',
  'utils/geometry': 'Pure SVG/canvas geometry math (polar-to-cartesian, arcs)',
  'utils/sanitize': 'DOMPurify wrapper for safe innerHTML',
  'utils/network': 'Node.js server-side: extract client IP from HTTP request',
  'ui/MainToolbar': 'Top toolbar: connection, graph, file, font size, help, settings buttons',
  'ui/TransportToolbar': 'Transport controls: play/pause/stop/rewind/clear via XState actor',
  'ui/Modal': 'Modal dialog with focus trap and Escape handling',
  'ui/PickerMenu': 'Grid/vertical picker menu with keyboard and gamepad navigation',
  'ui/DoubleRadialPicker': 'Dual SVG donut menu for gamepad category+item selection',
  'ui/RadialMenu': 'SVG donut menu segment renderer',
  'ui/Tabs': 'Generic tabbed panel with eager content rendering',
  'ui/SerialVis': 'Canvas-based waveform visualizer (Solid)',
  'ui/InternalVis': 'Dual-canvas visualizer with Catmull-Rom interpolation',
  'ui/ProgressBar': 'Bar progress indicator reading from visStore',
  'ui/VisLegend': 'Channel color/label legend for visualization',
  'ui/overlayManager': 'LIFO Escape-key stack and scroll-lock reference counting',
  'ui/settings/SettingsPanel': 'Settings panel: General + Themes tabs',
  'ui/settings/FormControls': 'Reusable form primitives (Section, FormRow, inputs)',
  'ui/help/HelpPanel': 'Help panel: User Guide, Reference, Snippets, Keybindings tabs',
  'ui/help/ModuLispReferenceTab': 'Searchable ModuLisp function reference with tag filtering',
  'ui/help/CodeSnippetsTab': 'User code snippet library with search and CRUD',
  'legacy/app/application': 'App lifecycle orchestration',
  'legacy/app/environment': 'Browser capability detection',
  'legacy/editors/editorConfig': 'Core eval path, font, panel toggles',
  'legacy/editors/extensions': 'CodeMirror extension assembly',
  'legacy/editors/main': 'Editor creation & autosave',
  'legacy/editors/keymaps': 'All CodeMirror keymaps',
  'legacy/editors/gamepadControl': 'Full gamepad controller logic',
  'legacy/editors/themes/themeManager': 'Theme application & CSS vars',
  'legacy/editors/themes/builtinThemes': 'Theme aggregation',
  'legacy/editors/themes/createTheme': 'Theme factory from recipe',
  'legacy/editors/extensions/structure': 'Expression gutter, node highlight',
  'legacy/editors/extensions/evalHighlight': 'Eval flash decoration',
  'legacy/io/useqWasmInterpreter': 'WASM interpreter boundary',
  'legacy/io/gamepad': 'Gamepad API abstraction',
  'legacy/io/mockControlInputs': 'Mock CV inputs for WASM',
  'legacy/ui/ui': 'Full UI bootstrap orchestration',
  'legacy/ui/serialVis/visualisationController': 'Vis state machine & WASM eval',
  'legacy/ui/serialVis/serialVis': 'Canvas 2D rendering loop',
  'legacy/ui/serialVis/utils': 'Palette management, color lookup',
  'legacy/config/configManager': 'Config import/export/save (WebSocket)',
  'legacy/config/configLoader': 'Settings bootstrap wrapper',
};

export const EDGE_LABELS = {
  // Bootstrap chain
  'legacy/main|runtime/bootstrap': 'bootstrap()',
  'runtime/bootstrap|legacy/config/configLoader': 'loadConfigurationWithMetadata()',
  'runtime/bootstrap|legacy/app/environment': 'examineEnvironment()',
  'runtime/bootstrap|runtime/bootstrapPlan': 'resolveBootstrapPlan()',
  'runtime/bootstrap|runtime/runtimeService': 'bootstrapRuntimeSession()',
  'runtime/bootstrap|runtime/runtimeDiagnostics': 'publishRuntimeDiagnostics()',
  'runtime/bootstrap|legacy/ui/ui': 'createAppUI()',
  'runtime/bootstrap|legacy/app/application': 'createApp()',
  'runtime/bootstrap|runtime/appSettingsRepository': 'replaceSettings()',

  // Settings flow
  'utils/settingsStore|runtime/appSettingsRepository': 'updateAppSettings()',
  'utils/settingsStore|lib/appSettings': 'mergeUserSettings()',
  'runtime/appSettingsRepository|lib/appSettings': 'normalize + persist',
  'runtime/appSettingsRepository|runtime/runtimeService': 'updateRuntimeSettingsEffect()',
  'runtime/appSettingsRepository|runtime/startupContext': 'getStartupFlagsSnapshot()',

  // Runtime session
  'runtime/runtimeService|runtime/runtimeSessionStore': 'updateRuntimeSessionState()',
  'runtime/runtimeService|runtime/runtimeDiagnostics': 'publishRuntimeDiagnostics()',
  'runtime/runtimeService|runtime/legacyRuntimeAdapter': 'sendHardwareCommand()',
  'runtime/runtimeService|contracts/runtimeEvents': 'dispatchRuntimeEvent()',
  'runtime/runtimeSessionStore|runtime/runtimeSession': 'createRuntimeSessionSnapshot()',

  // Transport → runtime
  'transport/connector|runtime/runtimeService': 'reportTransportConnectionChanged()',
  'transport/connector|transport/stream-parser': 'serialReader()',
  'transport/connector|transport/json-protocol': 'handleFirmwareInfo()',
  'transport/connector|transport/legacy-text-protocol': 'sendTouSEQ()',
  'transport/json-protocol|transport/stream-parser': 'setSerialOutputBufferRouting()',
  'transport/json-protocol|runtime/runtimeService': 'reportProtocolModeChanged()',
  'transport/json-protocol|contracts/runtimeEvents': 'JSON_META_EVENT',
  'transport/json-protocol|transport/upgradeCheck': 'upgradeCheck()',
  'transport/json-protocol|runtime/jsonProtocol': 'isJsonEligibleVersion()',
  'transport/legacy-text-protocol|transport/json-protocol': 'sendJsonEval() if JSON',
  'transport/stream-parser|legacy/ui/serialVis/visualisationController': 'handleExternalTimeUpdate()',
  'transport/stream-parser|lib/CircularBuffer': 'push(double)',

  // Effects
  'effects/transportOrchestrator|machines/transport.machine': 'createActor()',
  'effects/transportOrchestrator|effects/transport': 'play/pause/stop/rewind',
  'effects/transportOrchestrator|effects/transportClock': 'applyMockTimePolicy()',
  'effects/transportOrchestrator|runtime/runtimeService': 'subscribeRuntimeService()',
  'effects/transportOrchestrator|contracts/runtimeEvents': 'PROTOCOL_READY + JSON_META',
  'effects/transportClock|effects/mockTimeGenerator': 'start/stop/resume/reset',
  'effects/transportClock|runtime/runtimeService': 'subscribeRuntimeService()',
  'effects/transport|runtime/runtimeService': 'sendRuntimeTransportCommand()',
  'effects/ui|runtime/runtimeService': 'toggleRuntimeConnection()',

  // UI → effects
  'ui/TransportToolbar|effects/transportOrchestrator': 'useActorSignal(actor)',
  'ui/MainToolbar|effects/ui': 'toggleConnection/toggleGraph',
  'ui/MainToolbar|effects/editor': 'adjustFontSize/loadCode/saveCode',

  // Eval path
  'legacy/editors/keymaps|legacy/editors/editorConfig': 'evalNow/evalQuantised',
  'legacy/editors/editorConfig|legacy/io/useqWasmInterpreter': 'evalInUseqWasm()',
  'legacy/editors/editorConfig|transport/legacy-text-protocol': 'sendTouSEQ()',
  'legacy/editors/editorConfig|lib/editorStore': 'getEditorContent()',

  // Vis chain
  'effects/mockTimeGenerator|legacy/ui/serialVis/visualisationController': 'handleExternalTimeUpdate()',
  'legacy/ui/serialVis/visualisationController|legacy/io/useqWasmInterpreter': 'evalOutputsInTimeWindow()',
  'legacy/ui/serialVis/visualisationController|contracts/visualisationEvents': 'VISUALISATION_SESSION_EVENT',
  'utils/visualisationStore|contracts/visualisationEvents': 'addVisualisationEventListener()',
  'utils/visualisationStore|ui/SerialVis': 'reactive read',
  'legacy/io/useqWasmInterpreter|contracts/wasmAbi': 'validateWasmAbi()',

  // Editor
  'legacy/editors/extensions|legacy/editors/themes/builtinThemes': 'theme extensions',
  'legacy/editors/extensions|legacy/editors/keymaps': 'keymap extensions',
  'legacy/editors/main|legacy/editors/extensions': 'mainEditorExtensions',
  'legacy/editors/themes/themeManager|lib/editorStore': 'editor().dispatch()',
  'legacy/editors/themes/builtinThemes|legacy/editors/themes/createTheme': 'createTheme(recipe)',
  'legacy/editors/themes/createTheme|legacy/editors/themes/themeManager': 'createTheme()',
  'legacy/editors/extensions/structure|legacy/editors/extensions/evalHighlight': 'highlight',
  'legacy/editors/extensions/evalHighlight|legacy/editors/editorConfig': 'evalTree()',

  // Help
  'ui/help/ModuLispReferenceTab|utils/referenceStore': 'search()',
  'ui/help/CodeSnippetsTab|utils/snippetStore': 'load()',

  // Contracts (layer violations)
  'contracts/runtimeEvents|runtime/runtimeDiagnostics': '⚠ upward import',
  'contracts/runtimeEvents|runtime/runtimeSession': '⚠ upward import',
  'contracts/useqRuntimeContract|machines/transport.machine': '⚠ TransportState type',
  'lib/appSettings|legacy/editors/themes/themeManager': '⚠ theme validation',
  'lib/appSettings|runtime/runtimeDiagnostics': '⚠ type import',
  'lib/appSettings|runtime/startupContext': '⚠ nosave check',
  'utils/consoleStore|runtime/appSettingsRepository': 'updateAppSettings()',
};

export const FLOW_PRESETS = [
  {
    id: 'bootstrap',
    name: 'App Bootstrap',
    desc: 'DOMContentLoaded → full app startup',
    nodes: [
      { id: 'legacy/main', note: 'Entry point (Vite)' },
      { id: 'runtime/bootstrap', note: '6-step startup' },
      { id: 'legacy/config/configLoader', note: 'Load settings' },
      { id: 'runtime/appSettingsRepository', note: 'Replace active settings' },
      { id: 'legacy/app/environment', note: 'Detect browser capabilities' },
      { id: 'runtime/bootstrapPlan', note: 'Decide startup mode' },
      { id: 'runtime/runtimeService', note: 'Seed runtime session' },
      { id: 'runtime/runtimeDiagnostics', note: 'Publish diagnostics' },
      { id: 'legacy/ui/ui', note: 'Mount all UI' },
      { id: 'legacy/app/application', note: 'Start app' },
    ],
    edgeLabels: [
      'bootstrap()', 'loadConfigurationWithMetadata()', 'replaceSettings()',
      'examineEnvironment()', 'resolveBootstrapPlan()', 'bootstrapRuntimeSession()',
      'publishRuntimeDiagnostics()', 'createAppUI()', 'createApp().start()'
    ]
  },
  {
    id: 'eval',
    name: 'Code Eval → Hardware',
    desc: 'User presses Ctrl+Enter → code sent to uSEQ',
    nodes: [
      { id: 'legacy/editors/keymaps', note: 'Mod-Enter keymap' },
      { id: 'legacy/editors/editorConfig', note: 'evalToplevel()' },
      { id: 'legacy/io/useqWasmInterpreter', note: 'evalInUseqWasm() (local)' },
      { id: 'transport/legacy-text-protocol', note: 'sendTouSEQ()' },
      { id: 'transport/json-protocol', note: 'sendJsonEval() if JSON mode' },
      { id: 'transport/connector', note: 'Serial port write' },
    ],
    edgeLabels: [
      'evalNow()', 'evalInUseqWasm()', 'sendTouSEQ()', 'sendJsonEval()', 'port.writable.write()'
    ]
  },
  {
    id: 'serial-inbound',
    name: 'Serial Inbound → UI',
    desc: 'Hardware bytes → parsed → dispatched to UI',
    nodes: [
      { id: 'transport/connector', note: 'Serial port opened' },
      { id: 'transport/stream-parser', note: 'serialReader() byte loop' },
      { id: 'transport/json-protocol', note: 'handleJsonMessage()' },
      { id: 'contracts/runtimeEvents', note: 'JSON_META_EVENT dispatch' },
      { id: 'effects/transportOrchestrator', note: 'SYNC to XState actor' },
      { id: 'machines/transport.machine', note: 'State transition' },
      { id: 'ui/TransportToolbar', note: 'UI reflects new state' },
    ],
    edgeLabels: [
      'reader.read()', 'processAllMessages()', 'dispatchRuntimeEvent()', 'addRuntimeEventListener()', 'actor.send({SYNC})', 'useActorSignal()'
    ]
  },
  {
    id: 'stream-to-vis',
    name: 'Stream Data → Visualisation',
    desc: 'Binary stream frames → buffers → canvas rendering',
    nodes: [
      { id: 'transport/stream-parser', note: '11-byte STREAM frames' },
      { id: 'lib/CircularBuffer', note: 'serialBuffers[ch].push()' },
      { id: 'legacy/ui/serialVis/visualisationController', note: 'handleExternalTimeUpdate' },
      { id: 'legacy/io/useqWasmInterpreter', note: 'evalOutputsInTimeWindow()' },
      { id: 'contracts/visualisationEvents', note: 'VISUALISATION_SESSION_EVENT' },
      { id: 'utils/visualisationStore', note: 'applyVisualisationEvent()' },
      { id: 'ui/SerialVis', note: 'Canvas render from visStore' },
    ],
    edgeLabels: [
      'push(double)', 'ch0 → time update', 'batch WASM eval', 'dispatchVisualisationEvent()', 'reconcile() into store', 'reactive read'
    ]
  },
  {
    id: 'settings-write',
    name: 'Settings Write Path',
    desc: 'UI change → persist → propagate to all consumers',
    nodes: [
      { id: 'ui/settings/SettingsPanel', note: 'User changes a setting' },
      { id: 'utils/settingsStore', note: 'updateSettingsStore()' },
      { id: 'runtime/appSettingsRepository', note: 'updateAppSettings()' },
      { id: 'lib/appSettings', note: 'mergeUserSettings + normalize' },
      { id: 'runtime/runtimeService', note: 'updateRuntimeSettingsEffect()' },
      { id: 'runtime/runtimeSessionStore', note: 'Session recomputed' },
    ],
    edgeLabels: [
      'updateSettingsStore()', 'updateAppSettings()', 'merge + persist(localStorage)', 'dispatchSettingsChanged()', 'updateRuntimeSessionState()'
    ]
  },
  {
    id: 'transport-mode',
    name: 'Transport Mode Resolution',
    desc: 'Connection state → mode → machine → effects',
    nodes: [
      { id: 'transport/connector', note: 'setConnectedToModule()' },
      { id: 'runtime/runtimeService', note: 'reportTransportConnectionChanged()' },
      { id: 'runtime/runtimeSession', note: 'resolveTransportMode()' },
      { id: 'runtime/runtimeSessionStore', note: 'Store updated' },
      { id: 'effects/transportOrchestrator', note: 'send UPDATE_MODE' },
      { id: 'machines/transport.machine', note: 'Mode context updated' },
      { id: 'effects/transportClock', note: 'applyMockTimePolicy()' },
      { id: 'effects/mockTimeGenerator', note: 'Start/stop mock time' },
    ],
    edgeLabels: [
      'reportTransportConnectionChanged()', 'resolveTransportModeFromRuntime()', 'notifyListeners()', 'actor.send({UPDATE_MODE})', 'assign({mode})', 'actor.subscribe()', 'start/stop/resume/reset'
    ]
  },
  {
    id: 'protocol-negotiation',
    name: 'Protocol Negotiation',
    desc: 'Connect → probe firmware → upgrade to JSON',
    nodes: [
      { id: 'transport/connector', note: 'connectToSerialPort()' },
      { id: 'transport/legacy-text-protocol', note: 'sendTouSEQ("@(useq-report-firmware-info)")' },
      { id: 'transport/upgradeCheck', note: 'Parse version string' },
      { id: 'transport/json-protocol', note: 'maybeNegotiateJsonProtocol()' },
      { id: 'runtime/jsonProtocol', note: 'isJsonEligibleVersion (≥1.2.0)' },
      { id: 'transport/json-protocol', note: 'hello handshake → JSON mode' },
      { id: 'contracts/runtimeEvents', note: 'PROTOCOL_READY_EVENT' },
      { id: 'effects/transportOrchestrator', note: 'Query hardware state → SYNC' },
    ],
    edgeLabels: [
      '3500ms wait → probe', 'upgradeCheck(versionMsg)', 'handleFirmwareInfo()', 'versionAtLeast(1.2.0)', 'writeJsonRequest(hello)', 'dispatchRuntimeEvent()', 'queryHardwareTransportState()'
    ]
  },
  {
    id: 'vis',
    name: 'WASM Visualisation Pipeline',
    desc: 'Mock time → WASM eval → expression samples → canvas',
    nodes: [
      { id: 'effects/mockTimeGenerator', note: 'rAF tick → seconds elapsed' },
      { id: 'legacy/ui/serialVis/visualisationController', note: 'handleExternalTimeUpdate()' },
      { id: 'legacy/io/useqWasmInterpreter', note: 'evalOutputsInTimeWindow()' },
      { id: 'contracts/wasmAbi', note: 'cwrap: useq_eval_outputs_time_window' },
      { id: 'legacy/ui/serialVis/visualisationController', note: 'Build sample grid' },
      { id: 'contracts/visualisationEvents', note: 'Dispatch session event' },
      { id: 'utils/visualisationStore', note: 'Ingest into reactive store' },
      { id: 'ui/SerialVis', note: 'Render waveforms' },
    ],
    edgeLabels: [
      'handleExternalTimeUpdate(s)', 'evalOutputsInTimeWindow()', 'cwrap → HEAPF64', 'Float64Array samples', 'dispatchVisualisationEvent()', 'reconcile()', 'reactive canvas draw'
    ]
  },
  {
    id: 'gamepad',
    name: 'Gamepad UI Navigation',
    desc: 'Gamepad → Menu → Eval',
    nodes: [
      { id: 'legacy/io/gamepad', note: 'Gamepad API' },
      { id: 'legacy/editors/gamepadControl', note: 'Controller loop' },
      { id: 'ui/DoubleRadialPicker', note: 'Donut menu' },
      { id: 'legacy/editors/editorConfig', note: 'Eval target' }
    ],
    edgeLabels: ['poll()', 'openPicker()', 'onSelect()']
  },
  {
    id: 'structural',
    name: 'Structural Evaluation',
    desc: 'Gutter click → tree eval',
    nodes: [
      { id: 'legacy/editors/extensions/structure', note: 'Gutter & Tree' },
      { id: 'legacy/editors/extensions/evalHighlight', note: 'Flash decoration' },
      { id: 'legacy/editors/editorConfig', note: 'Eval path' }
    ],
    edgeLabels: ['click node', 'highlight', 'evalTree()']
  },
  {
    id: 'file-io',
    name: 'Local File I/O',
    desc: 'Toolbar → FS API → Editor',
    nodes: [
      { id: 'ui/MainToolbar', note: 'Save/Load buttons' },
      { id: 'effects/editor', note: 'File System API' },
      { id: 'lib/editorStore', note: 'Editor content' }
    ],
    edgeLabels: ['click', 'showOpenFilePicker()', 'setContent()']
  },
  {
    id: 'theme',
    name: 'Theme Application',
    desc: 'Settings → Build Theme → CSS',
    nodes: [
      { id: 'ui/settings/SettingsPanel', note: 'Theme dropdown' },
      { id: 'legacy/editors/themes/builtinThemes', note: 'Theme catalog' },
      { id: 'legacy/editors/themes/createTheme', note: 'Factory' },
      { id: 'legacy/editors/themes/themeManager', note: 'CSS Vars' }
    ],
    edgeLabels: ['selectTheme()', 'getRecipe()', 'createTheme()', 'applyCSSVars()']
  },
  {
    id: 'docs',
    name: 'Documentation Lookup',
    desc: 'Search UI → Ref Store',
    nodes: [
      { id: 'ui/help/ModuLispReferenceTab', note: 'Search UI' },
      { id: 'utils/referenceStore', note: 'Ref state' }
    ],
    edgeLabels: ['search()']
  }
];

export const KNOWN_CYCLES = [
  {
    nodes: ['legacy/io/serialComms', 'transport/legacy-text-protocol', 'transport/json-protocol',
      'transport/stream-parser', 'legacy/ui/serialVis/visualisationController', 'legacy/ui/serialVis/utils'],
    label: 'Transport/SerialComms Ring',
    desc: 'Crosses legacy/modern boundary 3 times.'
  },
  {
    nodes: ['runtime/appSettingsRepository', 'runtime/urlParams', 'utils/consoleStore'],
    label: 'Settings/Console Ring',
    desc: 'Fragile initialization ordering.'
  }
];

export const KNOWN_VIOLATIONS = [
  { from: 'contracts/runtimeEvents', to: 'runtime/runtimeSession', desc: 'Upward reach' },
  { from: 'contracts/runtimeEvents', to: 'runtime/runtimeDiagnostics', desc: 'Upward reach' },
  { from: 'contracts/useqRuntimeContract', to: 'machines/transport.machine', desc: 'Contract depends on machine type' },
  { from: 'lib/appSettings', to: 'legacy/editors/themes/themeManager', desc: 'Schema depends on consumer' },
  { from: 'lib/appSettings', to: 'runtime/runtimeDiagnostics', desc: 'Type import' },
  { from: 'lib/appSettings', to: 'runtime/startupContext', desc: 'Nosave check' },
  { from: 'utils/consoleStore', to: 'runtime/appSettingsRepository', desc: 'Circular link via settings' },
];
