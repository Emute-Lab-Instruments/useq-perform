# Stateful Expression Identity

> Spec: stable identity for anonymous stateful expressions across live edits,
> alternate top-level variants, probes, and hidden editor-side code rewriting.
> Counterpart to [MAIN.md](MAIN.md), [code-evaluation.md](code-evaluation.md),
> [probes.md](probes.md), and the runtime state spec
> [../../src-useq/docs/specs/state-identity.md](../../src-useq/docs/specs/state-identity.md).
>
> This document describes the intended product/runtime contract. It is not yet
> fully implemented. Existing runtime state is mostly slot-order based; this
> spec defines the target model needed to make state survive source edits in a
> way that matches user intent.

### Source Files

**Editor and app:**
- `src/effects/editorEvaluation.ts` - eval orchestration, active expression/result flow, runtime fan-out.
- `src/editors/extensions/expressionEval.ts` - evaluable-range detection and gutter/eval affordances.
- `src/editors/extensions/expressionEvalState.ts` - per-expression eval state; future home or consumer of active-state-identity metadata.
- `src/editors/extensions/evalHighlight.ts` - visual indication of the last-evaluated expression.
- `src/editors/extensions/probes.ts` - probe sampling and batch expression construction; future consumer of state identity for stateful probes.
- `src/editors/extensions/probeHelpers.ts` - AST/range helpers used to relate source ranges to expression identity.
- `src/editors/extensions/liveEdit/markAction.ts` - precedent for editor-generated stable ids in source.
- `src/lib/persistence.ts` - persistence service for document-side metadata.

**Runtime and language:**
- `src-useq/uSEQ/src/signal_engine/node_pool.h` - `NodePool::state_values[]`, `state_update_roots[]`, `state_slot_count`, `live_slots[]`.
- `src-useq/uSEQ/src/signal_engine/graph_builder.{h,cpp}` - stateful UGen compilation (`compile_phasor`, `compile_lfo`, `compile_slew`, `compile_sah`, `compile_count`, `compile_integrate`) and current anonymous slot allocation.
- `src-useq/uSEQ/src/signal_engine/executor.{h,cpp}` - `LoadState`, `LoadDt`, `SlotLoad`, `commit_state()`.
- `src-useq/uSEQ/src/signal_engine/cold_eval.{h,cpp}` - output assignment, dependency recompilation, `defstate` source tracking.
- `src-useq/wasm/wasm_wrapper.cpp` - WASM time injection, output sampling, projection-fork state clone/restore.

---

## 1. Frame

1.1 uSEQ has two kinds of state identity today:

- **Named state**: a top-level `defstate` cell is identified by its symbol. The runtime spec already says edits to that update body do not reset the state ([runtime state spec section 4](../../src-useq/docs/specs/state.md)).
- **Anonymous state**: stateful primitives and UGens inside expressions allocate state slots as the graph compiler walks the source. Examples include `phasor`, `lfo`, `slew`, `sah`, `count`, `noise`, and `integrate`.

1.2 Anonymous state is the weak point. If the user edits:

```lisp
(a1 (+ (phasor 1) (lfo 0.5)))
```

into:

```lisp
(a1 (+ (lfo 0.5) (phasor 1)))
```

the runtime cannot currently know which newly compiled state slot is "the same"
state the user meant to keep. Slot allocation order becomes user-visible as
phase resets, swapped state, or discontinuities.

1.3 The editor and runtime are allowed to cooperate. The visible document does
not need to carry every implementation detail, because `useq-perform` controls
both the main coding environment and the runtime payloads it sends to hardware
and WASM. Hidden editor-side identity metadata is therefore part of the product
model, not an implementation hack.

1.4 The target contract:

> Stateful expression identity is stable by user intent, not by compile order.
> Editing, moving, or evaluating alternate variants should preserve state when
> the user is working with the same musical object. Copying or running multiple
> instances should fork identity unless the user explicitly links them.

---

## 2. Concepts

2.1 **State ID.** A stable opaque identifier assigned to a stateful expression
or stateful expression family. The ID may be editor-generated and hidden. When
visible, it is shown as a short token or source annotation. The ID is not a
cell symbol and does not live in the same namespace as `define`, `defstate`, or
output names.

2.2 **State resource.** A runtime storage item keyed by a state ID and a
resource schema. Examples:

- oscillator phase
- previous trigger memory
- sample-and-hold held value
- counter value
- filter/integrator accumulator

2.3 **Resource schema.** The declaration, owned by a stateful primitive, of
which state resources it needs and which roles they play. A primitive may need
one resource (`phasor` phase), two resources (`sah` held value and previous
trigger), or several resources (`count` counter, previous trigger, reset latch).

2.4 **Active graph.** The compiled expression currently installed in the
runtime for an output, or the expression currently being evaluated for a probe
or REPL-style top-level expression. The app already communicates active output
status visually by highlighting the last-evaluated top-level output expression
([code-evaluation.md](code-evaluation.md)).

2.5 **Document variant.** A top-level form in the buffer that may target the
same output as other forms but is not currently active. Multiple `(a1 ...)`
forms in the document are normal. The last evaluated one is the active program
for `a1`.

2.6 **Duplicate state ID.** The same state ID can appear in multiple document
variants. This is allowed and often useful. Duplicate IDs are constrained only
when they are simultaneously active in the same compiled graph or runtime
scope (section 5).

---

## 3. User Model

3.1 Users commonly keep multiple expressions for the same output in the buffer:

```lisp
(a1 (saw 1))
(a1 (tri 0.5))
(a1 (sqr 2))
```

Only one is active at a time. The editor shows this through eval/gutter rails
and eval highlights. The inactive forms are variants, not competing programs.

3.2 It is natural for variants to share state:

```lisp
(a1 (saw 1 :id "phase-A"))
(a1 (tri 0.5 :id "phase-A"))
(a1 (sqr 2 :id "phase-A"))
```

Evaluating the first form, waiting, evaluating the second form, then returning
to the first should preserve the oscillator phase resource identified by
`phase-A`. The user is changing the law or shape of the module, not replacing
the module.

3.3 The modular-synth intuition is normative: changing waveform or frequency
on a running oscillator should not reset phase unless the user asks for a
reset. This applies whether the change is made by editing one expression in
place or by evaluating another linked variant.

3.4 Linkage is not always desired. Copying a stateful form to create a second
simultaneously running voice should fork state identity. Copying a form to make
an alternate inactive version of the same output should usually preserve state
identity. The editor must make this distinction explicit enough that users can
correct it.

---

## 4. Runtime Contract

4.1 Runtime state allocation must move from pure slot-order identity to
resource identity. The compiler should allocate dense executor slots from a
persistent registry:

```text
StateResourceKey = state_id + resource_kind + role
```

Examples:

```text
phase-A / oscillator-phase / phase
hold-B  / sample-hold      / held-value
hold-B  / trigger-memory   / previous-trigger
cnt-C   / counter          / count
cnt-C   / trigger-memory   / previous-trigger
cnt-C   / trigger-memory   / reset-latch
```

4.2 The executor remains dense and fast. State-resource lookup happens at
compile/eval time. Once compiled, `LoadState` nodes read dense slot indices as
they do today, and `commit_state()` writes dense slot indices as it does today
(`src-useq/uSEQ/src/signal_engine/executor.cpp`).

4.3 A stateful primitive declares a resource schema. The schema decides which
state can be shared across operators.

4.4 Oscillator-like primitives share an `oscillator-phase` resource:

```lisp
(phasor 1 :id "phase-A")
(saw 1 :id "phase-A")
(tri 1 :id "phase-A")
(sqr 1 :id "phase-A")
(lfo 1 :wave :tri :id "phase-A")
```

These forms may all preserve the same phase. The waveform is a view or shaping
function over the same phase resource.

4.5 Incompatible primitives do not reinterpret raw state just because the user
ID matches:

```lisp
(saw 1 :id "x")
(count gate :id "x")
```

The shared user ID `x` is visible to the editor as a relationship, but the
runtime keys different resources (`oscillator-phase` vs `counter`). The counter
does not receive the oscillator phase value.

4.6 An operator change is allowed when schemas are compatible or partially
compatible. Compatible resources continue; newly required resources initialise
from their declared defaults; resources no longer required become inactive.

4.7 Init arguments apply only when a resource is first created or explicitly
reset. Recompiling a stateful form with the same resource key must not replay
the init argument and reset the state.

4.8 Resource GC is independent of graph GC. Removing a stateful expression from
the active graph marks its resources inactive but does not immediately erase
them. This supports alternate variants and undo/redo. The exact retention
policy is implementation-defined but must be bounded and observable enough for
debugging. Reasonable V1: retain resources for the session or until
`useq-clear` / explicit reset.

4.9 `useq-clear` resets active output programs and should clear anonymous
state-resource registry entries unless a future session-persistence feature
explicitly keeps them. Named `defstate` reset semantics remain governed by the
runtime state spec.

---

## 5. Duplicate IDs

5.1 Duplicate state IDs are allowed in the document. This enables inactive
variants:

```lisp
(a1 (saw 1 :id "phase-A"))
(a1 (tri 1 :id "phase-A"))
```

5.2 Duplicate IDs in the same active graph are allowed only when the compiler
can prove the resources are used coherently.

5.3 This should be rejected or require an explicit sharing form:

```lisp
(a1 (+ (saw 1 :id "phase-A")
       (tri 2 :id "phase-A")))
```

Both forms would try to advance the same `oscillator-phase` resource with
different parameters. If both are active, which frequency owns the phase update
is ambiguous. The runtime must not choose silently.

5.4 A coherent explicit pattern is to separate phase source from waveform view:

```lisp
(a1 (let [p (phasor 1 :id "phase-A")]
      (+ (saw-shape p) (tri-shape p))))
```

The exact shape-function names are illustrative. The important distinction is
one state source feeding multiple pure views.

5.5 Duplicate active IDs with disjoint resource kinds may compile, but should
produce an editor-visible warning if the shared user ID looks accidental.
Example: one active `saw` and one active `count` with the same ID do not alias
runtime storage, but the visual ID relationship may still surprise the user.

---

## 6. Source Surface

6.1 The user-visible source syntax is not settled. Two compatible surfaces are
allowed by this spec.

6.2 **Keyword form**:

```lisp
(saw 1 :id "phase-A")
```

Advantages: compact, readable, consistent with the existing `live-edit :id`
precedent ([live-edit.md](live-edit.md)). Disadvantage: every stateful
primitive must accept or ignore `:id` in its argument grammar.

6.3 **Wrapper form**:

```lisp
(with-state-id "phase-A" (saw 1))
```

Advantages: uniform, works for future stateful forms without changing every
signature, easy for hidden editor injection. Disadvantage: more syntactic
noise when visible.

6.4 The compiler may normalise both forms into the same internal annotation.
The editor may inject whichever form is easiest to generate safely. The UI
should be able to reveal either a friendly `:id` view or the exact runtime
payload for debugging.

6.5 Hidden IDs are the default product surface. Normal users should not need
to see or type IDs while performing. The source document remains focused on
musical expressions; identity is editor metadata unless the user toggles the
debug view or writes an ID manually.

6.6 Hand-written IDs are valid. If the user types `:id` or `with-state-id`
explicitly, the editor must respect it and attach metadata to it rather than
silently replacing it.

---

## 7. Editor Metadata

7.1 The editor owns hidden state IDs for anonymous stateful forms. It creates,
preserves, forks, and reveals them using syntax-tree-aware metadata.

7.2 Metadata is keyed by source range plus structural context, not by raw text
alone. Whitespace edits and local parameter edits preserve IDs. Moving a form
preserves IDs. Replacing a stateful form with a distinct non-stateful form
detaches the ID unless undo restores it.

7.3 Metadata must persist with the editor document/session. A page reload
should not silently regenerate all state IDs, because that would erase the
meaning of linked variants. Persistence should use the central persistence
service (`src/lib/persistence.ts`) and follow [persistence.md](persistence.md)
error-recovery rules.

7.4 Eval-time rewriting is tree-aware. The editor must not use ad hoc string
replacement to inject IDs into code sent to the runtime. It must either rewrite
using parsed ranges or pass an out-of-band ID map through a future runtime API.

7.5 The visible buffer and runtime payload may differ. Diagnostics returned
from the runtime must map back to visible source ranges, hiding injected ID
syntax unless the user is in "show IDs" mode.

7.6 The ID metadata must compose with structural editing. Metas/wrappers that
move with nodes in [structural-editing.md](structural-editing.md) should carry
state identity with the stateful host form. Slurp, raise, transpose, wrap, and
unwrap should not reset identity merely because parent structure changed.

---

## 8. Copy, Paste, and Variant Semantics

8.1 The editor should infer paste intent from context, but always expose
commands to correct identity.

8.2 **Editing in place:** preserve IDs.

8.3 **Cut/move/paste of the same expression:** preserve IDs.

8.4 **Paste as an alternate top-level variant for the same output:** preserve
IDs by default. This supports the common workflow of keeping several `(a1 ...)`
forms and switching between them by eval.

8.5 **Paste into a different output:** fork IDs by default. The pasted voice is
usually a new voice, not the same oscillator moved to a new output.

8.6 **Paste inside the same active expression where both copies can run
simultaneously:** fork IDs by default. Duplicate active state sources are
dangerous unless deliberately linked.

8.7 **Paste into a non-output helper or callable:** preserve only if the
structural source/target context implies variant reuse; otherwise fork. This is
an open heuristic and should start conservative.

8.8 After a paste that contains stateful forms, the editor may show a small
non-blocking affordance: `linked state` / `forked state`, with an undo-like
toggle. The text is illustrative; the behaviour is normative.

8.9 Commands:

- **Fork state identity**: generate new IDs for the selected stateful form or
  subtree.
- **Link to same state as...**: assign the selected form the ID of another
  compatible stateful form.
- **Show state IDs**: reveal identity decorations or source annotations.
- **Reset state**: reset the runtime resource(s) for the selected ID.

---

## 9. Visual Design

9.1 State IDs are normally invisible. The editor should reveal relationships
only when relevant.

9.2 Hovering or focusing a stateful form with an ID highlights every other
form in the visible document that shares that ID. The interaction should feel
like variable-reference linking in language-aware editors: lightweight,
temporary, and anchored to source.

9.3 Linked forms may render with:

- subtle matching underlines or chips on hover/focus,
- dashed connector lines between visible linked forms,
- a small tooltip naming the resource relationship,
- a stronger warning style for duplicate active conflicts.

9.4 The visual link must distinguish same user ID from same runtime resource.
For example, `saw :id "x"` and `count :id "x"` share a user ID but not a
resource schema. The UI can show that they are related while warning that they
do not continue the same resource.

9.5 "Show state IDs" mode reveals IDs in a stable, copyable form. This is for
debugging, teaching, and deliberate hand-editing. It is not the default
performance view.

---

## 10. Probes and Top-Level Eval

10.1 Top-level eval should evaluate ordinary signal expressions at the current
runtime time instead of returning `ok` for every non-side-effect expression.
Examples:

```lisp
bar                 ; => current bar phasor
(* bar 0.5)         ; => current value
(eval-at-time 2 bar); => value at t=2
```

This is a prerequisite for reliable probe and inline-result behaviour. Runtime
semantics live in
[src-useq top-level.md section 2](../../src-useq/docs/specs/top-level.md) and
[src-useq state-identity.md section 6](../../src-useq/docs/specs/state-identity.md).
See [probes.md section 1.6](probes.md) for the current probe sampling contract.

10.2 Top-level vector forms should evaluate each element and return a numeric
vector string when possible:

```lisp
[(eval-at-time 0 bar) (eval-at-time 0.5 bar)]
; => [0 0.25]
```

The current probe batch path builds exactly this shape in
`src/editors/extensions/probes.ts`.

10.3 Pure and time-derived expressions can run in a scratch graph with no
persistent state. The scratch graph must not leak nodes into the live
`NodePool` and must not leak literal vector data tables into the live
`CellStore`.

10.4 Stateful top-level/probe expressions have three possible semantics:

- **Read live named state**: references to existing `defstate` cells read the
  live runtime state. This should be supported.
- **Fresh anonymous state**: an arbitrary stateful expression without an ID
  evaluates from newly initialised scratch state. This is acceptable for a
  one-off value but does not mirror a running output.
- **Identity-backed state**: a stateful expression with a state ID uses the
  persistent resource registry. This is the target for stateful probes and
  alternate variants.

10.5 Stateful probes should prefer identity-backed state when the probed
subexpression has an editor state ID. If no ID is available, the UI should
surface that the probe is using fresh/scratch state or restrict the waveform
to pure evaluation.

10.6 Projection forks, such as the WASM future projection logic in
`src-useq/wasm/wasm_wrapper.cpp`, are still needed for output sampling and
stateful batch rendering. State IDs solve identity; projection solves
read-only advancement through time without corrupting live state.

---

## 11. Runtime Projection and Mirroring

11.1 **Mirroring** means an expression eval/probe reads and updates the same
state resource that a live output would use, keyed by state ID.

11.2 **Projection** means evaluating future or alternate time samples in a
fork of live state, then discarding or retaining the fork without mutating live
state.

11.3 These solve different problems:

- State IDs answer "which state is this?"
- Projection answers "how do we sample it at many times without changing the
  live program?"

11.4 For a stateful batch probe, the correct implementation is sequential over
sample time. Each sample depends on the previous projected state. Vectorised
batch execution is valid only for pure expressions or expressions whose state
has been explicitly modelled for batch projection.

11.5 Projection cost is acceptable for probe-scale sample counts. The current
default probe sample count is small (`visualisation.probeSampleCount`, default
40). Stateful projection is O(samples * reachable_nodes) for that probe. This
is more expensive than pure vectorised execution but bounded and user-visible.

11.6 Dev cost is medium-high:

- runtime registry and schema support,
- compile-time duplicate validation,
- editor metadata and rewrite machinery,
- source-map/diagnostic remapping,
- stateful probe projection,
- tests across editing, copy/paste, eval variants, and runtime parity.

11.7 This should be implemented after the immediate top-level eval/probe fix.
The pure eval path unblocks `bar`, `beat`, `eval-at-time`, and `from-list`
highlights; identity-backed state is a foundational improvement but not a
minimal probe fix.

---

## 12. Failure Modes and Diagnostics

12.1 Duplicate active incompatible state IDs produce an error diagnostic at
the second active occurrence, with a suggestion to fork or explicitly share.

12.2 Same ID with incompatible resource schemas should not crash or silently
reinterpret values. It should either allocate separate resources under the same
user ID or warn when the relationship is likely accidental.

12.3 Unknown or malformed hand-written IDs produce a syntax/type diagnostic,
not a runtime crash.

12.4 Runtime payload diagnostics must refer to visible source ranges. Hidden
injected syntax should not create confusing diagnostic positions.

12.5 If metadata persistence fails, the editor may regenerate IDs, but it must
not claim continuity. A console warning is sufficient under
[persistence.md](persistence.md); visible state-link debugging may show the
IDs as new.

---

## 13. Implementation Plan

13.1 **Phase 1: explicit runtime IDs.**

- Add `:id` or `with-state-id` support to stateful primitives.
- Add a persistent state-resource registry.
- Keep executor dense-slot execution unchanged.
- Add tests for reorder, edit-in-place, operator-compatible changes, and
  incompatible changes.

13.2 **Phase 2: duplicate validation.**

- Detect duplicate active state sources in one compiled graph.
- Error on ambiguous same-resource updates.
- Warn or annotate same user ID with disjoint resources.

13.3 **Phase 3: editor hidden IDs.**

- Identify stateful forms in the syntax tree.
- Maintain sidecar IDs across CodeMirror transactions.
- Persist sidecar metadata.
- Rewrite eval payloads with IDs.
- Remap diagnostics from rewritten payloads to visible source.

13.4 **Phase 4: UX.**

- Add hover/focus linked-state decorations.
- Add show IDs, fork identity, link identity, and reset state commands.
- Add paste affordances for linked vs forked state.

13.5 **Phase 5: stateful probes.**

- Use state IDs for probe expressions.
- Project stateful probe windows sequentially from a fork.
- Surface fresh-state vs identity-backed-state mode in the probe widget.

---

## 14. Open Questions

14.1 Which syntax should be canonical in user-visible source: `:id`,
`with-state-id`, or both?

14.2 What is the bounded retention policy for inactive anonymous state
resources? Session-long retention is simplest; memory-bounded LRU may be
needed later.

14.3 Should linked variants survive page reload by restoring runtime state, or
only identity metadata? V1 should restore identity metadata only.

14.4 How should quantised eval interact with state ID transfer between
variants? The likely answer: identity transfer happens when the queued eval
actually commits, not when queued.

14.5 Should hardware expose a state-resource introspection command so the
editor can show current values, last-updated time, and active/inactive status?

14.6 Should source control/export include hidden metadata, or should "copy as
plain ModuLisp" strip it? The editor needs both modes.
