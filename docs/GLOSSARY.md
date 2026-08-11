# uSEQ Perform Glossary

Current names for concepts that cross module boundaries. This is a vocabulary
guide, not a file inventory; use [MAP.md](../MAP.md) to locate subsystems and
the linked specifications for detailed behaviour.

## Product and language

### uSEQ Perform

The browser editor and performance surface in this repository. It edits and
evaluates ModuLisp against hardware, the browser-local runtime, or both.

### ModuLisp

The Lisp dialect interpreted by uSEQ. A top-level form may define an output,
change transport state, declare a synth graph, or evaluate a regular value.
The language implementation is pinned under `src-useq/src/`.

### Expression

A ModuLisp form. “Top-level form” means a direct child of the document root;
that boundary matters for evaluation, diagnostics, output tracking, and stable
state identity.

### Output channel

A named analogue, digital, or stream output such as `a1`, `d1`, or `s1`.
Shared channel contracts live in `src/contracts/useqRuntimeContract.ts` and the
firmware-side schema lives under `src-useq/src/serial_protocol/`.

## Runtime and transport

### Bootstrap plan

The one startup decision derived from environment capabilities and settings.
It selects `hardware`, `browser-local`, `no-module`, or
`unsupported-browser`. See `src/runtime/bootstrap.ts`.

### Runtime coordinator

The canonical owner of runtime-session state and the selected WASM port. All
mutable runtime decisions enter through `transitionRuntimeCoordinator()` in
`src/runtime/runtimeCoordinator.ts`.

### Runtime session

The derived current execution shape: hardware connection, protocol mode,
browser-local availability, connection mode, and transport mode. The pure
derivation is in `src/runtime/runtimeSession.ts`.

### Connection mode

Where evaluation is available: `hardware`, `browser`, or `none`.

### Transport mode

Which runtimes receive shared transport commands: `hardware`, `wasm`, `both`,
or `none`. Do not confuse this with transport state.

### Transport state

Playback state (`playing`, `paused`, or `stopped`) owned by the transport state
machine in `src/machines/transport.machine.ts`.

### Browser-local runtime

The Worker-backed WASM runtime used when hardware is absent and as a shadow
runtime when compatible hardware is connected. Its typed boundary is
`src/contracts/runtimePorts.ts`; selection belongs to the runtime coordinator.

### No-module mode

A deliberate browser-only session. It seeds useful local expressions and does
not attempt hardware reconnection.

### Host port

The transport-independent interface presented to runtime effects. The Web
Serial implementation is `src/transport/webSerialHostPort.ts`; the native
bridge implements the same boundary in `src/transport/webSocketSerialPort.ts`.

### Protocol mode

The hardware wire mode: `json` for the typed 1.2 protocol or `legacy` for the
older text protocol. Protocol code lives in `src/transport/json-protocol.ts`
and `src/transport/legacy-protocol.ts`.

### Hello handshake

The negotiation that selects JSON mode and obtains firmware and I/O metadata.
The normative wire contract is `src-useq/docs/specs/wire-protocol.md`.

### Typed channel

An in-process publish/subscribe boundary used to keep effects and UI adapters
from sharing DOM event strings or singleton implementation details. Runtime
channels live in `src/contracts/runtimeChannels.ts`; visualisation and
synthesis use their own channel modules.

### Runtime diagnostics

A derived snapshot of startup mode, settings sources, active environment,
protocol mode, runtime session, and bootstrap failures. See
`src/runtime/runtimeDiagnostics.ts`.

## Editor and structural model

### Editor session

The active CodeMirror view signal and small view operations in
`src/lib/editorStore.ts`. Editor construction, settings subscriptions,
autosave, and destruction belong to `src/editors/editorLifecycle.ts`.

### Action

A stable input intent identified by `ActionId`. Definitions and default
bindings live in `src/lib/keybindings/`; higher-layer implementations live in
`src/editors/commands/actionHandlers.ts`.

### Editor command

A typed editor mutation or navigation request routed by
`src/editors/commands/editorCommandRouter.ts`. Keyboard, palette, and gamepad
input converge on this command boundary.

### Structural mode

The default tree-oriented editor mode. Navigation and mutations operate on
structural node identities rather than raw character offsets.

### Insertion mode

The text-editing mode entered inside a structural node. Its boundary is a
first-class CodeMirror state field, not an inferred keyboard state.

### Structural tree

The editor-side tree with stable node IDs, compound and leaf nodes, cursors,
holes, and wrapper metadata. Pure operations live under
`src/editors/extensions/structure/core/`; CodeMirror adaptation lives under
`src/editors/extensions/structure/adapter/`.

### Structural cursor

An ID-based node or range selection in the structural tree. It is distinct
from CodeMirror’s character selection, though the adapter keeps them aligned.

### Hole

A first-class unfilled structural node written as `($ name :type)`. Holes are
atomic, block evaluation of their top-level form, and can drive radial-menu
auto-chaining. See `src/editors/extensions/structure/core/holes.ts`.

### Wrapper meta

Semantic metadata represented by a wrapper form but attached to a host node in
the structural model. `live-edit` is the current example. A wrapper meta is not
a structural hole.

### State identity

The persistent hidden identity assigned to stateful top-level forms so runtime
state survives edits and reordering. See
`src/editors/extensions/stateIdentity/`.

### Eval highlight

The short-lived CodeMirror decoration marking the evaluated range. Normal and
soft evaluation use distinct styles. See
`src/editors/extensions/evalHighlight.ts`.

### Soft evaluation

A preview evaluation that does not commit state. It uses the `eval.soft`
action and the runtime’s projection/preview boundaries.

### Quantised evaluation

Evaluation scheduled for a transport boundary rather than sent immediately.

### Live edit

A marked literal whose value can be manipulated without rewriting and
re-evaluating the whole source on every gesture. Store, persistence, batching,
and runtime dispatch live in `src/effects/liveEditRuntime.ts`; widgets live in
`src/editors/extensions/liveEdit/`.

### Manual-control binding

A transient mapping from a gamepad stick to a live-editable source range. The
range mapping is owned by `src/lib/manualControlState.ts`; editor-specific axis
application is owned by `src/editors/gamepadNavigation.ts`.

## Gamepad and menus

### Gamepad pipeline

The hardware snapshot, gesture recognition, layer resolution, and dispatch
pipeline under `src/lib/gamepad/`. It receives higher-layer action execution
and editor-context readers through dependency injection.

### Layer

A predicate-controlled gamepad binding map. Transient layers take precedence;
masking layers prevent lower layers from receiving unmatched gestures.

### Resolution

The result of resolving one gesture or axis frame against the active layer
stack. The dispatcher applies its action, axis publication, and optional undo
policy.

### Radial menu

The full-takeover, double-ring content picker. Pure menu state and verb
application live under `src/lib/menu/`; the Solid renderer is
`src/ui/menu/RadialMenu.tsx` and its mount adapter is
`src/ui/adapters/radialMenu.tsx`.

### Menu verb

An operation that combines picked content with a captured editor target:
insert, replace, wrap-with, or call. These are distinct from direct structural
verbs such as slurp, barf, raise, and enclose.

### Main menu

The application-level overlay for navigation and session actions. Its state is
under `src/lib/mainMenu/`; its renderer and adapter live under
`src/ui/mainMenu/` and `src/ui/adapters/mainMenu.tsx`.

## Visualisation and synthesis

### Visualisation

The WebGL waveform surface for recorded past and projected future output. The
runtime owns sampling and buffers under `src/effects/`; rendering lives under
`src/ui/visualisation/`; reactive session state is in
`src/utils/visualisationStore.ts`.

### Past buffer

The bounded time-series buffer used for recorded and projected samples. Its
implementation is `src/lib/PastBuffer.ts`; allocation and ownership belong to
`src/effects/visualisationBuffers.ts`.

### Probe

An editor annotation that asks the runtime to sample an intermediate
expression. Probe model, rendering, and sampling modules live under
`src/editors/extensions/probes/`.

### Synthesis service

The browser audio-engine boundary owning AudioContext activation, worklet
module loading, graph transactions, producer control, telemetry, and recovery.
Its core state machine is `src/audio/synthesisService.ts`.

### NodeDef

A registered DSP node implementation used by synth declarations. The shared
registry contract is `src/contracts/nodeDefRegistry.ts`; native and WASM
implementations are pinned in `src-useq/nodedef/`.

### Producer

The Worker-side control producer that advances synth control data ahead of the
AudioWorklet consumer. Program epochs prevent stale data from being rendered
after graph replacement.

## Settings and build terms

### App settings

The canonical persisted configuration shape. Schema and defaults live in
`src/lib/settings/schema.ts`; normalization lives in
`src/lib/settings/normalization.ts`; runtime access is through
`src/runtime/appSettingsRepository.ts`.

### Settings source

The provenance recorded while loading configuration: defaults, local storage,
URL configuration/code, or `nosave` startup mode.

### Generated asset

A build output whose source identity and generation command are recorded in a
manifest. Generated assets are checked by contracts under `src/contracts/` and
must not be treated as hand-maintained source.

### Firmware source of truth

The pinned `src-useq/` submodule. Browser and firmware contracts must agree
with its profile manifests and generated protocol schema; copied historical
trees are not authoritative.

## Naming rules

- Prefer **visualisation** in prose and new identifiers; `serialVis` remains in
  established APIs where renaming would add noise without removing ambiguity.
- Use **browser-local** for the WASM execution mode; use **WASM** for the
  implementation technology or ABI.
- Use **transport state** for play/pause/stop and **transport mode** for runtime
  routing.
- Use **ActionId** for input intent and **editor command** for the typed editor
  operation it triggers.
- Use **typed channel**, not “custom event”, for current in-process event
  boundaries.
