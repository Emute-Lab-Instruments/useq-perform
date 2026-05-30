---
stability: evolving
layer: behavioural
---

# Expression Gutter

> Spec: gutter rails (which expression is currently running) and play buttons (per-output vis toggle). Counterpart to [MAIN.md](MAIN.md).
> See also [editor.md](editor.md) for editor-surface integration, [code-evaluation.md](code-evaluation.md) for eval semantics, [visualisation.md](visualisation.md) for sampling and rendering.

### Source files

- `src/editors/extensions/expressionHighlights.ts` — gutter marker rendering, rail decoration
- `src/editors/extensions/expressionEval.ts` — evaluable-range detection, gutter marker hookup
- `src/editors/extensions/expressionEvalState.ts` — per-expression eval state (last-evaluated, success/failure)
- `src/effects/editorEvaluation.ts` — eval orchestration, rail-active assignment, implicit vis-on
- `src/utils/visualisationStore.ts` — per-output vis toggle state, exclusivity enforcement
- `src/utils/outputHealthStore.ts` — per-output health flags consumed by rail failure indicator
- `src/effects/visualisationSampler.ts` — implicit soft-sampling of toggled-but-unevaluated variants
- `src/lib/persistence.ts` — vis-toggle persistence keys
- `src/lib/keybindings/actions.ts` — `vis` category, `vis.toggleAtHalo` action

## 1. Surface

1.1 The main editor's left **expression gutter** marks every recognised top-level form that assigns to a uSEQ output (recognition pattern in [code-evaluation.md §1.8](code-evaluation.md), e.g. `(a1 …)`, `(d3 …)`, `(s2 …)`). Each such form gets a vertical coloured **rail** spanning its source range, plus a **play button** (▶) at the rail's top. The gutter is gated by `ui.expressionGutterEnabled` (default `true`); when disabled, neither rails nor play buttons render. Secondary editors include the gutter only when evaluation is in scope ([editor.md §1.8](editor.md), §1.13).

1.2 **Channel-coloured.** Rail and play-button colour are per output channel — every form targeting `a1` shares a1's colour, every form targeting `d3` shares d3's colour. Colour assignment is theme-coupled and matches the visualisation lane colour for the same output ([visualisation.md §1.8](visualisation.md)).

1.3 **AST-synced.** The gutter must reflect the current document state on every keystroke, not snapshots. Adding, removing, or editing a form updates the rails on the next CodeMirror state transaction ([editor.md §1.8](editor.md)).

1.4 **Forms that are not output assignments** (helpers, `define`, free expressions) get **no rail and no play button.** The gutter is exclusively about output programs. Forms that are syntactically malformed, contain holes, or do not match the output-assignment pattern at the top level fall in this bucket.

---

## 2. Active Rail

The "active" state on a rail indicates that **this expression is the most recently evaluated variant for its output, and is therefore the one currently producing voltages on the module.**

2.1 **Active assignment on eval.** When the user evaluates a form and the runtime accepts it, that form's rail becomes active for each output it assigns to. At most one rail per output is active at any time — the latest accepted eval wins. Forms targeting other outputs are unaffected.

2.2 **Multiple assignments per form.** A `do` block (or any container) may assign to several outputs in one eval, e.g. `(do (a1 …) (a2 …) (d1 …))`. The whole form's rail becomes active for **each** of those outputs simultaneously. If the same output is assigned more than once inside the same form (`(do (a1 (saw 1)) (a1 (tri 0.5)))`), the **latest assignment** is the one whose value reaches the output, but the rail-active state still belongs to the whole form (rails are a property of the form's source range, not of sub-positions).

2.3 **Re-eval is a visual no-op on the rail.** Evaluating the already-active form for an output produces the normal eval flash ([code-evaluation.md §1.5](code-evaluation.md)) but does not change the rail's active state — it was already active. The flash is "I just ran this"; the rail is "this is what's running".

2.4 **Soft eval does not move the rail.** Soft eval is a WASM-only preview that does not commit to hardware ([code-evaluation.md §1.1](code-evaluation.md)). The rail tracks "what is running on the module", which a soft eval does not change. The visually-distinct soft-eval flash is the only feedback at the rail's range.

2.5 **Failure pulse.** When the most recent eval for an output **fails to compile or produces a runtime error**, the rail moves to that form (it is the latest attempt) and renders with a **slow pulsing red overlay** indicating "the module is on this expression's LKG, not on its intended behaviour" (LKG semantics: [MAIN.md §2.1](MAIN.md), [`failure-model.md`](../../src-useq/docs/specs/failure-model.md)). The pulse persists until either:
- a successful eval at the same range clears it, or
- the user evaluates a different variant for the same output (rail moves; pulse stops).

The failure-pulse signal is sourced from [`outputHealthStore`](code-evaluation.md) (`error` / `fallback` states).

2.6 **Stale-edit pulse.** If the user edits the active expression's source after eval, and the edit is **non-trivial** (anything beyond pure whitespace or pure comment changes), the rail stays active but renders with a **white-bordered pulse** indicating "the module is running an older version of this code". The pulse clears on the next successful eval of that range. The implementation classifies "non-trivial" by tokenising both versions and comparing non-trivia tokens; whitespace and comment tokens are ignored. (Open question: 5.3.)

2.7 **First-load and restore.** On app startup, **no rail is active** until the user evaluates a form, even if the document was restored from persistence and identical code is presumed to be running on hardware. This is a known limitation; a hardware-side "what is currently running per output" surface would let the editor restore active rails on connect without forcing a re-eval. Until that ships (§5.1), the user re-evaluates after reload.

2.8 **Cut, paste, structural moves.** Source-position changes that move an active form (cut+paste, structural shuffle, container wrap/unwrap that preserves the form intact) carry the active state with the form, including any failure or stale pulse. Splitting the form (e.g. unwrapping it so the assignment is no longer a single sub-tree) or changing the assigned output (e.g. retyping `a1` to `a2`) drops the active state — the rail is no longer active for the original output, and the new arrangement starts inactive until evaluated.

---

## 3. Play Button — Vis Toggle

The play button (▶) on each rail toggles whether that expression is the one being **visualised** for its output channel.

3.1 **Per-output exclusivity.** At most one expression per output is vis-toggled on at a time. Toggling on variant B for `a1` toggles off whichever variant for `a1` was previously on. Different outputs are independent — a1 and d3 each have their own toggle slot.

3.2 **Independent from active.** The vis toggle is decoupled from the rail-active state. The user may visualise a variant that is **not** the currently-running one — the play button can sit on a form that has never been evaluated on the module.

3.3 **Implicit soft sampling.** When the toggled-on variant is not the rail-active one for its output, the runtime **implicitly soft-samples** the toggled expression — running it locally in WASM purely for the vis trace, without sending it to hardware. This is what makes "see what this variant would do without committing it" possible from the gutter alone. The sampling cadence and projection model are the standard ones from [visualisation.md](visualisation.md); the only difference is the source expression.

3.4 **Eval implicitly toggles vis on.** Every successful **non-soft** eval of a recognised output assignment also toggles its vis on for that output (turning off any other variant of that output that was previously toggled). The user does not have to click play to see what they just evaluated. This subsumes the "mark output as running so visualisation knows to sample it" behaviour previously described in [code-evaluation.md §1.8](code-evaluation.md). **Soft eval is the explicit exception**: a soft eval is an inspection action and does **not** flip the toggle. To make a non-active variant the visualised one without committing, click the play button (or use `vis.toggleAtHalo`).

3.5 **Default state.** On first load, no expression is vis-toggled. The visualisation panel's empty state ([visualisation.md §1.6](visualisation.md)) is shown for any output with no toggled variant.

3.6 **Trace continuity on swap.** Toggling from variant A to variant B for the same output **preserves the past buffer** for that output. The user sees A's recorded history followed by B's projected future at the moment of swap, with a visible discontinuity at `t = now` (paralleling the eval-driven discontinuity in [visualisation.md §2.4–2.5](visualisation.md)). The future buffer is reset and reset-filled under variant B at the moment of toggle (same path as eval-driven invalidation, [visualisation.md §3.7](visualisation.md)).

3.7 **Persistence.**
&nbsp;&nbsp;&nbsp;&nbsp;3.7.1 The toggle state survives **page reload**: it is persisted via the persistence service ([persistence.md](persistence.md)) and restored on startup, keyed by output and by a stable identifier of the toggled form (matching the state-identity model in [state-identity.md](state-identity.md)).
&nbsp;&nbsp;&nbsp;&nbsp;3.7.2 The toggle state survives **expression source edits**, including non-trivial edits — the toggle stays attached to the form's range as the text changes. Cut-and-paste to a different document position carries the toggle with the form. If the form is split or its output assignment changes (parallel to §2.8), the toggle is dropped.
&nbsp;&nbsp;&nbsp;&nbsp;3.7.3 The toggle state is **reset on hardware connect or disconnect**. A runtime-shape change is treated as a clean slate: the editor clears all per-output toggles and waits for fresh user activity. *Rationale:* a connect/disconnect implies the running program may not match what the editor last knew; a fresh slate avoids misleading visualisation associations until the user re-engages.

3.8 **Output not in connected hardware's I/O config.** When the user toggles vis on for an output that the connected hardware does not report (e.g. `a4` on a 3-analogue module, [code-evaluation.md §1.8](code-evaluation.md)), the toggle still functions for WASM-driven visualisation. The editor logs a **browser console warning** naming the output. Same when the user evaluates such a form — eval succeeds and WASM may visualise it, but a warning surfaces.

3.9 **Visual contract.**
&nbsp;&nbsp;&nbsp;&nbsp;3.9.1 **Off:** the play button is rendered with no fill (or a darker tone of the channel colour), indicating "this variant is not the visualised one".
&nbsp;&nbsp;&nbsp;&nbsp;3.9.2 **On:** the play button is rendered with a solid fill in the channel colour. CSS class `.cm-expr-play-btn.is-visualising`.
&nbsp;&nbsp;&nbsp;&nbsp;3.9.3 **Greyed:** when the form is not a recognised output assignment, the play button is rendered greyed out and is non-interactive. Hovering or activating it is a no-op.

3.10 **Hardware-only mode.** In hardware-only mode (no WASM, [runtime-modes.md](runtime-modes.md)), implicit soft sampling is impossible — there is no local engine to run an unevaluated variant. The play button still works as a per-output **display selector**: toggling moves the channel highlight to the chosen variant, but the visualisation trace shown remains whatever the hardware streams for that output (which always reflects the rail-active variant). This mismatch is acceptable because under hardware-only the user cannot meaningfully visualise an unevaluated variant — soft sampling requires WASM.

---

## 4. Action Surface

4.1 A new keybindings action category, **`vis`**, owns vis-related actions. Its first member:

| Action ID | Description | When | Reversible |
|---|---|---|---|
| `vis.toggleAtHalo` | Toggle vis on/off for the **top-level form at the current structural halo position**. Same exclusivity and implicit-soft-sampling semantics as a play-button click. | `editor.focused` | yes (toggling back restores the previous state) |

4.2 The action operates on the **top-level form containing the current halo position** ([structural-editing.md](structural-editing.md)). If the halo is on a form that is not a recognised output assignment, the action is a no-op (and may surface a transient announcer hint per [keybindings.md](keybindings.md)).

4.3 The action flows through the standard pipeline ([keybindings.md §1.1](keybindings.md), [input-dispatch.md](input-dispatch.md)) so it is reachable from keyboard, action palette, and gamepad alike. Adding the category to [keybindings.md §1.2](keybindings.md) is part of the same change as registering the action.

4.4 **Default binding: none** at the time of writing. Keybinding defaults are being reworked; the action is registered with `category: "vis"` and no default key. Users may bind it via the keybindings panel or palette until defaults land.

---

## 5. Open / Deferred

5.1 **Hardware-connect rail-restore.** §2.7 — the editor should sync with hardware on connect to recover active-rail state for forms whose source matches what hardware reports as running. Requires a hardware-side "currently running per output" surface plus a stable matching scheme. Deferred until that protocol surface exists.

5.2 **Stale-pulse classifier.** §2.6 distinguishes "trivial" (whitespace/comments) from "non-trivial" edits via tokenised comparison. The exact trivia rules (e.g. is reformatting trivial when it preserves all tokens?) may need tuning once users live with the pulse. Refine based on feedback.

5.3 **Soft-eval rail feedback.** §2.4 — soft eval leaves no per-form rail trace beyond the flash. Whether a transient "soft-evaluated recently" mark on the rail would help the user track what they have been auditioning vs. what is live is open. Currently the eval flash is the only signal.

5.4 **Stale-edit pulse (§2.6) — not yet implemented.** The white-bordered stale pulse requires per-active-form source snapshots plus a non-trivia tokenised comparison on every edit. Neither the snapshot store nor the tokeniser exists today; the rail does not pulse on edit. Implement alongside the classifier work in §5.2.

5.5 **Vis-toggle persistence (§3.7) — not yet implemented.** `visualisationStore` holds toggled expressions in memory only: nothing is written through the persistence service (§3.7.1), and there is no connect/disconnect reset (§3.7.3). Persisting requires a stable per-form identifier (the [state-identity.md](state-identity.md) model) that vis toggles do not yet carry. Deferred until that identity scheme is available for vis toggles.
