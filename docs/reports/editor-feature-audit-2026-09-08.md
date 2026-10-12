# Editor feature audit — 2026-09-08

Reviewed visualization selection and sampling, expression gutters, inline probes, indexed-list highlights, evaluation flashes, inline results, editor configuration, persistence and lifecycle. Structural editing, live-edit widgets, command routing and related UI received the broader regression run described below; this is not exhaustive acceptance of every editor feature.

Ergon audit: `work:bc882f25-e804-4b90-ab7b-5a424db971fe` — verified, with operator review attention. The checkout began with 237 `git status --short` entries. Existing changes were preserved; no commit, push, deployment or firmware rebuild was performed.

## Fixed findings

These are 13 groups of related defects, not a count of individual assertions. All have high confidence from reachable code paths plus focused regressions or the browser reproductions below. P1 means potentially incorrect execution or cross-document corruption; P2 means incorrect feedback, persistence or lifecycle behavior.

| # | Severity | Source | Behavior and evidence |
|---|---|---|---|
| 1 | P1 | `src/editors/extensions/expressionEval.ts:108`, `:223` | Gutter clicks could send code to hardware and select the first variant rather than the clicked one. Evaluation also selected the first definition. Clicks now only toggle visualization of the exact source range; accepted evaluation registers the actual form and each output in a `do` block. Integration regressions verify the second variant and zero hardware sends. |
| 2 | P2 | `src/editors/extensions/expressionEvalState.ts:28` | Regex-based recognition accepted references, quoted/comment/string text and incomplete assignments, and missed grouped outputs. A shared syntax-tree collector recognizes complete direct assignments and sequential `do` assignments, excluding malformed forms and holes. Eight negative cases and grouped-output tests cover this. |
| 3 | P2 | `src/editors/extensions/expressionHighlights.ts:198`, `:359` | Gutter state compared line numbers with source offsets, so button selection and halo selection disagreed. Buttons now carry exact offsets and sit at the top of their rail. Shared-line markers render side by side; browser inspection caught and corrected vertical overflow for multi-output `do` blocks. |
| 4 | P1 | `src/editors/extensions/probes.ts:121`, `src/editors/extensions.ts:169` | A global probe configuration let editors overwrite one another's persistence callbacks. Embedded editors could restore/save the main document's probes and collide with its runtime slots. Configuration is now per editor state; secondary editors have local probe state and use slot-free sampling. Two-editor regressions cover isolation. |
| 5 | P2 | `src/editors/extensions/probes.ts:380`, `:510` | Awaited samples could overwrite ranges/settings changed while sampling, and removing the last probe could strand its runtime slot. Sampling uses a revision check before publishing; unused slots are released after removal or completion, including teardown. Deferred-result and last-probe regressions cover this. |
| 6 | P2 | `src/editors/extensions/probes.ts:234`, `src/editors/extensions/probes/probeModel.ts:69` | Unrelated edits cleared restored mismatch warnings; successful same-length edits did not persist updated cached code. Mismatches now remain until source matches again, and persistence signatures include the complete probe specification. Saved offset/depth validation was tightened. |
| 7 | P2 | `src/editors/extensions/probes/probeSampling.ts:125`, `:186` | Empty text became numeric zero, while error results could replace the last valid cached expression. Empty results stay nonnumeric, and recognized errors trigger the cached-expression retry. Focused sampling regressions cover both. |
| 8 | P2 | `src/editors/extensions/probeHelpers.ts:163`, `:293`, `src/editors/extensions/probes/probeSampling.ts` | Comments polluted temporal arguments; literal `(list ...)` counted its constructor as an element; computed collections were assigned fictitious element locations. Identical list forms also shared fallback index state across distinct contexts. Literal child recognition, source ordering and per-occurrence fallback keys now agree. |
| 9 | P2 | `src/editors/extensions/probes/probeRendering.ts:273` | Probe widget equality ignored controls and dimensions, so adding an enclosing temporal wrapper left context controls missing. Destroying an old widget could remove its replacement's registry entry. Equality now includes widget settings, and teardown only removes the matching DOM registration and releases its canvas. |
| 10 | P2 | `src/editors/extensions/probes.ts:458` | Context-line drawing called `coordsAtPos` during a CodeMirror update, crashing the plugin and leaving probes on “sampling...”. Drawing now runs in a keyed measurement callback. This was reproduced in Chromium; JSDOM did not reproduce the layout failure. |
| 11 | P2 | `src/editors/extensions/evalHighlight.ts:82` | Repeated evaluation flashes were cleared by earlier timers. Each view now owns one replaceable timer with teardown cleanup. A real repeated-flash regression covers the timeout boundary. |
| 12 | P2 | `src/editors/extensions/inlineResults.ts:184`, `:237` | One editor's inline-result timer canceled another editor's dismissal. Timers are now per view and cleaned up on destruction. Two-editor regressions verify independent dismissal and clearing. |
| 13 | P2 | `src/effects/visualisationSampler.ts:804` | A failed preview registration could discard the previously selected expression. Registration now checks the evaluation result before replacing selection or clearing future samples. The regression preserves the previous selection on error. |

## Decisions and incomplete behavior

| Priority | Follow-up | Status / proposed direction |
|---|---|---|
| P1 | Preview shares the active browser interpreter (`src/effects/visualisationSampler.ts:804`). Silent evaluation suppresses feedback but still changes interpreter state. A gutter preview can affect the browser's running output; independent previewing also needs coherent behavior when a grouped form assigns other channels. | **User explicitly chose a separate change.** Recorded as `work:8855f10e-e614-4905-93be-8b91e33fe4b7`. This pass removes gutter hardware sends but does not create an isolated preview runtime. |
| P2 | Stable visualization identity, reload persistence, connect/disconnect reset, active-rail movement and stale-edit pulse are incomplete. `docs/specs/expression-gutter.md` explicitly records part of this as deferred. The active range and visualization selection still lack full mapping through edits/moves. | Asked whether to implement broader identity/persistence or retain the bounded bug-fix scope. Recommendation: a separate identity-backed change covering both rail and toggle semantics. Proposal: `work:c5fa42b0-d85e-4a39-97ec-3576b0ff2096`. |
| P2 | Contextual probes multiply their displayed window duration by the temporal factor (`src/editors/extensions/probes/probeSampling.ts:205`). A 1000ms control under `slow 4` samples four transport seconds. | Asked whether the label means transport seconds or a scaled musical duration. Behavior is unchanged pending confirmation. Probe follow-up proposal: `work:0bd0fe37-dab0-46c7-91c6-f6d5cbbe654b`. |
| P2 | Probe recovery/feedback remains incomplete: no visible indication that cached code is being sampled; out-of-range restored probes are filtered out; no recovery interface for stale probes; temporal wrappers beyond literal `slow`/`fast` have incomplete support. Persistent canvas dimensions also lack corresponding resize controls. | Asked whether to record a separate completion pass or implement now. Operator coverage needs agreement against the pinned runtime's actual symbols; do not infer legacy aliases from helper names. |
| P2 | Vite development mode cannot start the classic WASM worker: browser reports `Cannot use import statement outside a module` (`src/runtime/wasmRuntimeWorkerPort.ts:125`). The source worker contains imports, while its classic bootstrap depends on `importScripts`. | Bundled frontend starts successfully. Treat the dev-server worker/bootstrap contract as a separate follow-up; simply switching to a module worker would break its bootstrap. Proposal: `work:c8f2f03c-ab76-45e7-bded-e70fe5cc1506`. |

## Verification

- Initial representative baseline: 127 tests passed before edits.
- Broad editor/effects/UI run: **1,413 passed, one skipped**, across 90 files. Command: `npm exec vitest -- run --project unit --maxWorkers=1 src/editors src/effects src/ui/adapters/visualisationPanel.test.ts src/ui/MainToolbar.test.tsx src/utils/visualisationStore.test.ts`.
- Following the final gutter layout and probe measurement changes: **65 tests passed** across `probes.test.ts`, `editorVisualisation.test.ts`, and `expressionHighlights.test.ts`.
- `npm run test:mocha`: **358 passed, nine pending**.
- `npm run typecheck` and `npm run typecheck:tests`: passed again after the final probe measurement fix.
- ESLint on changed source modules: no errors. Ten test-file warnings state that the repository's lint configuration ignores those files; their TypeScript and Vitest checks were run separately.
- `git diff --check`: passed.
- Temporary frontend build: `npm exec vite -- build --outDir /tmp/useq-editor-audit/site/solid-dist` passed. Existing chunk-size warnings remain. The repository's generated frontend assets were not replaced.
- Firmware provenance check: pinned `src-useq` commit is `3f73fcc81f14fadf7b8d1770f7feeb09c9042f7c`; the existing dirty checkout is `02299d22870f528f47b27f81fbd37ff4e2838f60`. Existing WASM assets were reused. These results are not a clean pinned-firmware build, physical hardware verification, or production acceptance.

### Browser reproduction and verification

An isolated Chromium session used a disposable document, `devmode=true`, `disableWebSerial=true`, and `nosave`. Fixture text was set through the mounted CodeMirror transaction API; gutter clicks and probe shortcuts used browser input.

1. Multi-output `do`: before the layout fix, six buttons overflowed down unrelated lines. Afterward, their top coordinates matched and their horizontal coordinates differed, with parallel rails spanning the grouped form.
2. Two `a1` variants: clicking the second multiline `(a1 0.9)` selected only its button and `__useqBrowserEval.sampleOutputAtTime("a1", 0)` returned **0.9**. The first button retained its off state. No hardware was connected; the separate integration regression asserts zero hardware sends.
3. Contextual probe in `(slow 4 bar)`: the initial browser run caught the CodeMirror layout-read crash. After the fix, the plugin remained alive with a 138×46 waveform canvas. Clicking decrease changed the contextual depth from 1/1 to 0/1, and the window slider changed its displayed value to 2800ms. The remove button then reduced the visible probe count to zero. Screenshot: `/tmp/useq-editor-audit/probe-verified.png`.

Local run artifacts, including baseline/current status, baseline diff, audit-only diff, test logs and screenshots, are in `/tmp/useq-editor-audit/`. These are verification artifacts; Ergon remains the task tracker.

The temporary servers and isolated browser session were closed after verification.
