---
stability: stable
layer: behavioural
---

# Probes & From-List Highlights

> Spec: probe widgets and the syntactic from-list highlight that rides on top of them. Counterpart to [MAIN.md](MAIN.md).
> See also [code-evaluation.md](code-evaluation.md) (eval lifecycle) and [editor.md](editor.md) (main-editor surface).

### Source files

- `src/editors/extensions/probes.ts` — probe CodeMirror state field, commands, and view-plugin orchestration
- `src/editors/extensions/probes/probeModel.ts` — persisted-state normalisation, signatures, and render revision model
- `src/editors/extensions/probes/probeSampling.ts` — batch/slot sampling, expression planning, and indexed-form highlight evaluation
- `src/editors/extensions/probes/probeRendering.ts` — widget DOM registry, WebGL drawing, and decoration construction
- `src/editors/extensions/probes/probeTypes.ts` — shared probe contracts and defaults
- `src/effects/visualisationSession.ts` — sole production probe availability/eval/slot-sampling seam
- `src/editors/extensions/probeHelpers.ts` — `buildProbeExpression()`, recognised-operator set, wrapper-depth logic
- `src/ui/visualisation/webglLineRenderer.ts` — `drawProbeWaveformGL()` / `releaseProbeGLState()`: the per-probe WebGL waveform rendering surface
- `src/editors/extensions/expressionEval.ts` — expression evaluation helpers used by probe sampling

## 1. Probes

1.1 A **probe** is an inline, time-following sample widget attached to a user-marked subexpression in the main editor. (see `src/editors/extensions/probes.ts`) It displays the value of the marked expression sampled at (and around) the current transport time, on a per-probe WebGL-backed rendering surface adjacent to the marked range.

1.2 Probes are a main-editor feature. Tutorial playgrounds may include them where pedagogically useful. Read-only secondary editors (code examples, snippet previews, theme demos) do not surface probes. Secondary editors **must not** register probes against the global visualisation store ([editor.md §1.14](editor.md)).

1.3 **Activation** is via a keybinding (`probe` action category — see [keybindings.md §1.2](keybindings.md)). Activation toggles a probe at the current selection/cursor position. The `probe.active` keybinding context predicate is true while the cursor sits inside any active probe range.

### 1.4 Probe modes

1.4.1 Each probe has a **mode**: `raw` or `contextual`.

1.4.2 **`raw`** samples the bare expression text at the marked range. No surrounding temporal wrappers are applied. `depth` is fixed at 0.

1.4.3 **`contextual`** samples the expression with surrounding temporal wrappers (`slow`, `fast`, `offset`, `shift`) applied up to `depth` levels of `maxDepth`. `maxDepth` is the count of recognised wrappers enclosing the marked range, computed from the AST. `depth` is user-adjustable (left/right carets in the probe widget) within `[0, maxDepth]`. `depth = 0` in contextual mode is observationally equivalent to `raw`. (see `src/editors/extensions/probeHelpers.ts` for wrapper-depth computation)

1.4.4 The probe widget displays `"raw"` or `"<depth>/<maxDepth>"` as the depth label. The right caret is disabled when `depth === maxDepth`; the left caret is disabled when `depth === 0`.

### 1.5 Probe lifecycle

1.5.1 **Insert** registers a probe sampling channel. The probe's expression is built from the marked range plus any wrappers up to `depth`, and cached as `cachedCode`.

1.5.2 **Remove** unregisters the probe. Visualisation channels for that probe disappear within one frame. From-list highlights are independent of probe activity (§2.4) and are not affected.

1.5.3 **Live edit** of the probed range or its enclosing wrappers (while the session is active and the user is typing) **re-registers** the probe with the new text. The probe ID is stable across edits that preserve the probe's anchor; cosmetic edits (whitespace) must not unregister. This applies only to edits made during the current session — see §1.8.3 for restore-from-persistence semantics.

1.5.4 If the AST cannot resolve the probe range to a valid expression (e.g. the range was deleted, or now spans broken syntax), the probe enters a **fallback** display state showing the last known good value with a "using last valid expression" note, and the widget reads `"probe unavailable"` if no cached code exists. Fallback must not crash the editor; the probe persists in state until the user removes it.

1.5.5 **Stale state** applies only on **persistence restore** (page reload), not during live editing. If, on restore, the AST resolves the probe range to a *different* expression than `cachedCode` (text has changed at the saved offsets), the probe enters a **stale** state — visible, not sampling, with a warning icon and "probe text changed" tooltip suggesting the user delete and recreate the probe. Stale probes never silently rebind to mismatched text. See §1.8.3 for full restore semantics.

### 1.6 Probe sampling

1.6.1 Probes are batch-sampled at `visualisation.probeRefreshIntervalMs` (default 33 ms). All active probes are gathered and dispatched together; one batch is in flight at a time per editor. (see `src/editors/extensions/probes.ts` for scheduling and `src/editors/extensions/probes/probeSampling.ts` for sampling)

1.6.2 **Perf budget** ([MAIN.md §3.4](MAIN.md)): one WASM call per probe per tick after batching. Probes scale linearly, not multiplicatively, with sample-per-tick count.

1.6.3 Probe sampling routes through the `visualisationSession.probes` Worker-shadow facet only. Hardware does not evaluate probe expressions. In `hardware`-only mode (configured off, unavailable, or failed), probe widgets render in a **visually-disabled state**: they remain in the document and persisted state, retain their last-known sample if any, and surface a "WASM disabled" indicator. They do not sample and do not consume CPU.

1.6.4 Sampling is animation-frame paced. The probe sampler no-ops when the editor is hidden or the document has no probes.

### 1.7 Probe rendering

1.7.1 Each probe renders on a WebGL-backed surface adjacent to the marked range, drawn by `drawProbeWaveformGL()` (see `src/ui/visualisation/webglLineRenderer.ts`), wired by `src/editors/extensions/probes/probeRendering.ts`. Default surface size is `DEFAULT_PROBE_CANVAS_WIDTH × DEFAULT_PROBE_CANVAS_HEIGHT`; per-probe size is adjustable at runtime.

1.7.2 Each probe has its own window duration (`windowDurationMs`). On creation it inherits from the global default (`visualisation.probeDefaultWindowDurationMs`, fallback to `DEFAULT_PROBE_WINDOW_DURATION_MS`). Once the user adjusts the per-probe window, that probe is **sticky**: it does not follow subsequent changes to the global default. Newly-created probes after a global change pick up the new default. The global default is independent of the vis-panel `visualisation.windowDuration` ([visualisation.md §1.3](visualisation.md)) — the panel and the probes are different surfaces with different time-scope intents.

1.7.3 The rendered trace covers a per-probe window ending at the current transport time: the probe samples `[now − windowDuration, now]` and draws the resulting waveform. Probes are **past/present-only** — they do not project the future to the right of `now`. Whether probes should adopt the main panel's faithful-past / projected-future split ([visualisation.md §1.2](visualisation.md)) is an open question deferred in [visualisation.md §9.4](visualisation.md): the per-probe surface is narrow and the benefit may not justify the complexity. Until that is resolved, the past-only window is the contract.

1.7.4 Probe rendering must remain smooth across runtime transitions. A hardware connect/disconnect must not blank probe surfaces or lose in-flight traces.

### 1.8 Probe persistence

1.8.1 Probe state is persisted to `uSEQ-Perform-Editor-Probes` (soft-compatibility key — see [persistence.md §1.3](persistence.md)).

1.8.2 The persisted shape per probe is:
- `id` — string, stable across edits.
- `from` / `to` — document offsets at save time.
- `mode` — `"raw"` or `"contextual"`.
- `depth` / `maxDepth` — non-negative integers, `depth ≤ maxDepth`.
- `cachedCode` — the last-built expression text, used as fallback when re-resolution fails.
- `canvasWidth` / `canvasHeight` — per-probe rendering-surface size.
- `windowDurationMs` — per-probe window duration.

1.8.3 **Restore semantics.** On load, each probe is re-anchored at its saved `from`/`to` offsets and the expression is rebuilt against current document text.
- If rebuild succeeds **and** the rebuilt code matches `cachedCode`: probe restores to active sampling state.
- If rebuild succeeds **but** the rebuilt code differs from `cachedCode`: probe enters **stale** state (1.5.5) — visible, not sampling, requiring user re-confirm or removal. Probes never silently rebind to mismatched text.
- If saved offsets are out of bounds, or the rebuilt expression is broken syntax, or rebuild returns null: probe enters **fallback** state (1.5.4).
- Probes are never silently dropped at restore time.

## 2. From-List Highlights

2.1 **Recognised operators (v1).** The set of indexed-list operators is currently: `from-list`, `from-flat-list`, `seq`. These are recognised syntactically — by the head symbol of the form, not by runtime introspection. The set is hardcoded in `probeHelpers.ts` (see `src/editors/extensions/probeHelpers.ts`); this spec is the canonical list. Adding a new indexed-list operator requires a coordinated update to both this section and the implementation. The language semantics spec ([../../src-useq/docs/specs/MAIN.md](../../src-useq/docs/specs/MAIN.md)) cites this section as a downstream consumer.

&nbsp;&nbsp;&nbsp;&nbsp;2.1.1 **Future direction: runtime detection.** The hardcoded operator set is a v1 simplification. The goal is to detect any phasor-indexed list access at runtime, regardless of operator name — including user-defined wrapper functions that use `seq` internally on a list visible in source code. The mechanism (builtin self-registration, WASM-side tracing, or AST analysis) is undecided. When implemented, §2.1 narrows to the fallback for cases runtime detection cannot reach.

2.2 **Form shape.** A recognised form's first argument is a phasor expression in `[0, 1]`; remaining arguments are list elements. The active element is `floor(elementCount × clamp(phasor, 0, 1))`, clamped to a valid index.

2.3 **Visual contract.** When a recognised form's phasor resolves to a valid value, the active list element is highlighted in-place in the source. Highlights are editor decorations on the marked element's range; they do not modify the document. If the active range and highlight class are unchanged between sampling ticks, the existing decoration remains mounted rather than being replaced.

2.4 **Always on.** From-list highlights are a syntactic editor affordance independent of probe activity — they teach the language by showing which list element is active right now. Highlights are computed for every recognised form in the visible document regardless of whether any probes exist. Probes and from-list highlights are **orthogonal features** that happen to share an extension and a sampler.
&nbsp;&nbsp;&nbsp;&nbsp;2.4.1 The setting **`visualisation.fromListHighlights`** (boolean, default true) globally disables highlight computation. When false, no highlights are computed or rendered regardless of recognised forms. Intended for users on weak hardware.

2.5 **Two highlight classes**:

2.5.1 **Contextual highlight.** Computed for every recognised form in the visible document, using the form's phasor expression with full surrounding temporal wrappers applied (`buildProbeExpression(..., "contextual")`). Visually distinct from raw highlight.

2.5.2 **Raw highlight.** Computed for a recognised form when a `raw`-mode probe covers it *and* the probe's built code matches the form code exactly. Uses the form's phasor expression with no wrappers (`buildProbeExpression(..., "raw")`). This is the one place where probes and from-list highlights interact: a raw probe lets the user see the highlight as it would index without any temporal-wrapper influence.

2.5.3 A single recognised form may produce both a contextual and a raw highlight simultaneously (different active indices when wrappers shift the phasor). Both are rendered.

2.6 **Refresh cadence.** From-list highlights refresh on the same `visualisation.probeRefreshIntervalMs` schedule as probe sampling, sharing the same batch dispatch. They are not independently paced. With zero probes and recognised forms present, the batch contains only highlight computations. A bare `bar` phasor uses the authoritative `bar` value published by the visualisation sampler for the current data tick; it is not evaluated again through the asynchronous silent-eval path.

2.7 **Failure modes.** An empty, erroneous, or non-finite phasor result is not coerced to element zero. If the same recognised form has a last valid index, a transient evaluation failure retains that index until a later valid result arrives; if no valid index exists, no highlight is produced. Cached indices are discarded when the corresponding form is no longer present. Failure must not throw or interrupt other forms' highlight computation.

2.8 **Nested and composed forms** (`(seq … (from-list …))`, `(slow 4 (from-list …))`) are recognised independently per nesting level. Each recognised form computes its own highlight from its own phasor.

2.9 **Eval-mode interaction.** From-list highlights reflect the *current* program state, sampled via WASM. A soft eval ([code-evaluation.md §1.1](code-evaluation.md)) updates highlights as part of the full local preview — the user sees which list element would be active under the previewed code. A failed quantised/immediate eval leaves prior highlights unchanged (matching the LKG semantics of [MAIN.md §2.1](MAIN.md)).

2.10 **Hardware-only mode.** From-list highlights require WASM (the phasor evaluator). When WASM is disabled ([runtime-modes.md §1.10](runtime-modes.md)), no highlights are rendered, matching probe behaviour in §1.6.3.
