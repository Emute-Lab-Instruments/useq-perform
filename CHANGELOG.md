# Changelog

All notable changes to this project will be documented in this file.

## v1.2.0 — Unreleased draft

Proposed release notes, compared with editor v1.1.0. The release date and
firmware revision are not yet selected. See the
[release scope and unfinished-feature decisions](docs/releases/v1.2.0-scope.md)
for implementation status and acceptance requirements. Items below are
candidate shipping content, not a declaration that release validation passed.

### Editor

- Structural editing of Lisp expressions: navigate and select forms, wrap,
  unwrap, move, duplicate, slurp and barf, with visible focus and typed holes
  for unfinished expressions. Switch to insertion mode for ordinary text edits.
- Contextual atom editing: adjust numbers, cycle related symbols and values,
  and change polarity without rewriting the surrounding expression.
- Gamepad navigation and editing, a radial menu of forms and templates,
  grab/move controls, numeric and T9 text entry, and a main menu.
- Configurable keyboard profiles and layouts, action discovery, contextual
  shortcut hints, and editable bindings.
- Structural formatting that preserves layout outside the edited area, plus
  explicit formatting commands and formatting preferences.
- Atomic saving of document text with state-identity metadata, with isolated
  secondary editors for examples and help.
- Expanded language reference, interactive guide examples, the “How uSEQ
  thinks” chapter, and the live Machine schematic. Zen mode provides a
  focused structural-editing practice surface.

### Runtime

- A compiled ModuLisp signal runtime shared by current firmware and browser
  WASM, with reactive definitions and functions, dependency updates, declared
  state, and bounded stateful signal operators.
- Per-output last-known-good behavior and structured diagnostics: a rejected
  form preserves its previously accepted output behavior; unhealthy samples
  hold the last finite value under the default policy while healthy outputs
  continue.
- Protocol-v1 hardware negotiation with request-correlated evaluation,
  heartbeat, configurable streams, transport feedback, and explicit hardware
  target and capability information.
- Browser-local execution in a dedicated Worker, with startup and failure
  handling that keeps the editor usable when the runtime is unavailable.
- Browser audio foundation with routed `osc/sine` instances, modulation,
  multiple nodes, transactional graph changes, and engine recovery. The
  current sound library contains only `osc/sine`; a wider library and synth
  graph editor are not included in this draft scope.

### Editor + runtime

- Evaluate code locally or on connected uSEQ hardware, with shared transport
  controls and distinct connection states. With current JSON hardware, WASM
  can provide visualisation alongside hardware-owned outputs.
- Inline evaluation results, source-linked diagnostics, per-output health,
  and gutter indicators for running expressions and visible output traces.
- Waveform visualisation with recorded past, projected future, per-output
  lanes, inline probes, and sequence-element highlighting.
- Stable identities for anonymous stateful expressions across supported
  edits and variants. Saving identity metadata does not save a running
  runtime's state.
- Source-based `live-edit` controls with inline widgets and a dockable panel,
  gamepad control, and browser MIDI input with MIDI learn.
- Source-based hardware button/toggle bindings, inline binding chips, and
  test-fire controls. Physical input support is specific to the connected
  hardware profile.
- Compatibility with detected pre-1.2 hardware for core raw evaluation and
  incoming streams. Current WASM does not emulate the older language or
  supply matching shadow evaluation for legacy hardware.
- Firmware beta update support with target selection, size/hash verification,
  a Chromium directory-write flow, and a verified-download fallback. Public
  artifacts and physical update acceptance remain release prerequisites.

### Fixes and reliability

- Keep browser-local evaluation working with newer Chromium WASM memory
  behavior, and check the production Worker evaluation path during release
  validation.
- Avoid retaining production audio audit records indefinitely.
- Preserve output visualisation while browser audio is suspended, and reset
  transport progress consistently when stopping.
- Improve probe and sequence highlights, per-output error feedback, and
  persistence behavior across document and runtime changes.

### Compatibility and pending release decisions

- Current firmware introduces substantial language changes from pre-1.2.
  The final migration examples must match the selected compiler, generated
  reference, editor, and firmware image.
- The approved attached-modifier syntax (`sin[uni]`, `saw[lfo]`) is unfinished
  in the current compiler/editor. It is a proposed release requirement,
  **not yet a shipped feature**.
- CV calibration has an editor shell but no firmware takeover/storage
  backend. It is excluded from the proposed release scope.
- Full hardware-to-WASM state restoration, a wider synth library and synth
  editor, and temporal-query/graphics extensions remain outside the default
  promise while their scope decisions are open.
- Browser MIDI input does not imply MIDI output, firmware MIDI, NISPS
  integration, or audio synthesis on the module.

### Developer tools

- Engine Ledger displays language specs and runs supported conformance
  witnesses in an isolated runtime. It remains developer-only; unsupported
  witness operations are reported as unsupported.
- Expanded structural YAML, component, runtime-contract, and browser journey
  coverage, with generated compiler/served-asset identity checks.

## [v1.1.0](https://github.com/Emute-Lab-Instruments/useq-perform/releases/tag/v1.1.0) (e506828)

Released on: 2025-02-24

### Fixes

- Fix comments by stripping them out before sending to uSEQ (f947bfb)
  - NOTE: temporary fix until next uSEQ firmware.

### Improvements

- Console:
  - Increase maximum lines and make it scrollable (9c850ab)
  - Add '>' prefix to console messages (2493c5a)
- Visualisation of signals:
  - Improve serial visualization scaling and markers (13a40bb)
  - Add dotted zero line and quarter-mark indicators
- Better help panel styling and add toggle for Mac bindings (5492a94)
- Add wiggle animation to "connect" button for "uSEQ not connected" message (c988c06)

### Code Quality & Refactoring

- Major codebase refactoring (63bc30d):
  - Add comments
  - Centralize exports near top of modules
  - Better panel state management
- Split main.mjs into smaller files for better maintainability (a51e213)
- Fix comment handling inside expressions (f947bfb)
- Simplify "new firmware release" message (2f7c5bb)
- Remove debug print statements (4ed3c22, 9c850ab)

### Documentation

- Add CODEBASE_TOUR.md with project structure overview and extension guidelines (35058ec)
- Enhance code documentation in CircularBuffer.mjs with comments and error handling (320fff6)

### Other

- Add .local to .gitignore for local-only resources (ee2c9fe)

## [v1.0.0](https://github.com/Emute-Lab-Instruments/useq-perform/releases/tag/v1.0.0)

Released on: 2025-02-24

### New features:

1. Cycle through themes
2. Font size adjustment
3. Line numbers

### Improvements:

1. Better graphics for serial streams
2. Undo function fixed
4. It's more difficult to create orphaned brackets
5. Better looking buttons
6. Better serial connection management