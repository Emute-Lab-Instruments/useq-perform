# Inline Probe Handoff

Date: 2026-03-24

Primary Beads issue: `protocol-uj1`

Follow-up issue for browser validation and tuning: `useq-perform-htw`

## What This Feature Is

This is a new editor-owned inline probe system for inspecting arbitrary
subexpressions as functions of time.

Core user model:

- Every expression is implicitly time-dependent.
- `raw` mode means: evaluate the selected expression with only its own internal
  semantics, ignoring outer temporal wrappers.
- `contextual` mode means: evaluate the selected expression after wrapping it in
  some number of outer temporal modifiers from the AST path to the nearest
  top-level form.
- Context depth is per probe and can be expanded/contracted one wrapper at a
  time.
- Visible `from-list`-style forms are auto-highlighted contextually.
- A raw indexed-item highlight appears when the indexed form itself has an
  active raw probe.

## Current Keybindings

- `Alt-P`: toggle contextual probe on current node
- `Alt-Shift-P`: toggle raw probe on current node
- `Alt-H`: expand contextual depth by 1 layer for the contextual probe under
  cursor, or nearest contextual probe on the current line
- `Alt-S`: contract contextual depth by 1 layer
- `Alt-/`: help panel

`Escape` intentionally does nothing for probes. Probes are removed by retoggling
their binding or clicking the hover-only `x` on the widget.

## Current Implementation Shape

The feature is implemented from within CodeMirror rather than as a separate UI
panel.

Key files:

- `src/editors/extensions/probes.ts`
  Main probe implementation. Owns:
  - persistent probe state field
  - widget decorations
  - probe commands
  - viewport-scoped visible-form scanning
  - sampling loop
  - indexed-item highlight updates

- `src/editors/extensions/probeHelpers.ts`
  Pure helper layer for:
  - current-node range capture
  - temporal-wrapper discovery
  - raw/contextual probe expression construction
  - visible indexed-form discovery
  - `from-list` index calculation matching the interpreter

- `src/runtime/wasmInterpreter.ts`
  Added `evalInUseqWasmSilently()` so internal probe sampling does not publish
  `codeEvaluated` events and does not behave like a user eval.

- `src/lib/persistence.ts`
  Added `PERSISTENCE_KEYS.editorProbes`.

- `src/ui/styles/editor.css`
  Widget chrome and indexed-item highlight styles.

- `src/editors/keymaps.ts`
  Probe bindings and help remap.

- `src/editors/extensions.ts`
  Registers `probeExtensions` in the main editor extension bundle.

## How Probes Currently Work

Probe persistence:

- Probe specs are stored in localStorage under `uSEQ-Perform-Editor-Probes`.
- Specs persist:
  - `from`
  - `to`
  - `mode`
  - `depth`
  - `maxDepth`
  - `cachedCode`
- Specs map their positions through document changes using CodeMirror
  `ChangeDesc.mapPos`.

Probe code construction:

- Temporal wrappers currently recognized:
  - `slow`
  - `fast`
  - `offset`
  - `shift`
- Wrapper discovery is AST-based, not regex-based.
- Context depth applies wrappers from inner to outer.
- Example:
  selected node `(slow 2 bar)` inside outer `(slow 2 ...)`
  - raw: `(slow 2 bar)`
  - contextual full: `(slow 2 (slow 2 bar))`

Widget placement:

- v1 uses an inline widget decoration inserted immediately after the probed
  form.
- The file comments in `probes.ts` note two follow-up layout options to test:
  block widget under the form and floating overlay anchored from editor coords.

Sampling:

- Sampling is currently front-end-only and does **not** require `src-useq`
  changes.
- The implementation relies on the existing browser-local WASM eval path.
- It samples probe expressions via repeated silent evals.
- It uses `offset` as the sampling harness instead of mutating interpreter time
  for every sample.
- Window size is currently `1 bar`, expressed in raw seconds.
- `barDur` is read from WASM to determine the window duration.
- The widget currently shows a trailing history window, not a centered
  past/future view.
- Sampling is throttled by `PROBE_REFRESH_INTERVAL_MS` in `probes.ts`.

Non-numeric outputs:

- If the current result is non-numeric, the waveform is replaced with text.
- If the result begins with `Error:`, the widget is treated as an eval error
  state.
- If the current code fails, the implementation falls back to the probe's last
  valid cached expression.

## Indexed-Form Highlighting

This currently supports:

- `(from-list [..] phasor)`
- `(from-flat-list [..] phasor)` when the collection argument is a literal
  vector/list in the source
- `(seq [..] phasor)`
- shorthand `([..] phasor)`

Matching behavior:

- The active index calculation intentionally matches current interpreter
  semantics in `src-useq/uSEQ/src/modulisp/builtins_interpolation.cpp`:
  - clamp phasor to `[0, 1]`
  - compute `floor(count * phasor)`
  - clamp the `1.0` case back to the last element

Current highlight behavior:

- contextual highlight is always on for visible indexed forms
- raw highlight is only added when the indexed form itself has an active raw
  probe

This was chosen to keep raw highlighting available without automatically
coupling a raw probe on the phasor child to the parent `from-list` item
highlight.

## Tests Added

- `src/editors/extensions/probeHelpers.test.ts`
  Covers:
  - raw/contextual expression building
  - explicit context depth behavior
  - indexed-form discovery
  - `from-list` index semantics

- `src/editors/extensions/probes.test.ts`
  Covers:
  - probe toggle behavior
  - per-probe depth changes
  - raw-probe defaults

## Verification Run In This Session

Passed:

- `npm run test:unit -- src/editors/extensions/probeHelpers.test.ts src/editors/extensions/probes.test.ts src/lib/persistence.test.ts src/runtime/wasmInterpreter.test.ts`

Notes:

- Full repo `npm run typecheck` still reports many pre-existing errors outside
  this feature area.
- The filtered pass for touched probe files was clean apart from the existing
  missing type declarations for `@nextjournal/clojure-mode`.

## Important Current Limitations

1. The probe sampler currently uses repeated silent WASM evals.
   This is good enough for a first landing, but it needs real browser
   profiling with multiple visible probes.

2. There is no dedicated interpreter export for arbitrary probed time windows.
   If the current approach proves too expensive, the next step is probably a
   batch/probe export in `src-useq` rather than more frontend patching.

3. Raw indexed-item highlighting currently depends on a raw probe on the
   indexed form itself.
   This may or may not be the final UX.

4. Probe persistence is localStorage-backed editor metadata, not a full
   CodeMirror `EditorState.toJSON()` / `fromJSON()` pipeline.
   There is no such pipeline elsewhere in the repo today.

5. There has not yet been manual browser validation of:
   - widget scroll/edit anchoring
   - restore-on-reload behavior
   - contextual vs raw semantics across nested wrappers
   - performance with several visible probes and visible indexed forms

## Suggested Next Steps For Future Agents

1. Read `src/editors/extensions/probes.ts` and `src/editors/extensions/probeHelpers.ts`.

2. Run the targeted unit tests above.

3. Manually validate in the browser:
   - probe toggling
   - context depth changes
   - reload persistence
   - indexed-item highlights for `from-list` and shorthand
   - non-numeric text rendering

4. Profile repeated silent probe sampling with multiple visible probes.

5. Decide whether to keep the current frontend-only sampler or promote probe
   batching into `src-useq`.

## Session Note

This session intentionally did **not** modify `src-useq`.
The `src-useq` submodule was left as-is per user instruction.
