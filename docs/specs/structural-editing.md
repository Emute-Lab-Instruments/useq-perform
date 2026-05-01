# Structural editing and navigation

> Spec: ontology and algebra of structural coding in the main editor. Foundation for all keyboard- and gamepad-driven structure operations. Counterpart to [MAIN.md](MAIN.md).
> See also [editor.md](editor.md) §1.10 (which this spec elaborates), [keybindings.md](keybindings.md) for the action registry, [gamepad.md](gamepad.md) for input bindings.
>
> This spec defines what structural operations *mean*. Concrete keyboard chords and gamepad buttons live in the input specs; both reach the same operations defined here.

---

## 1. Frame

1.1 Structural coding is a first-class mode of interacting with the document. The editor maintains a tree-shaped model of the source and exposes operations that move and mutate that tree directly. Users do not think in characters or lines while in this mode; they think in nodes.

1.2 This spec defines the **ontology** (what the tree is) and the **algebra** (what operations exist and how they compose). Input devices bind their controls to operations defined here. The same operation has the same effect regardless of which device triggered it.

1.3 Structural coding is **focus-primary**: the canonical state is which node(s) the user is on, not where a character cursor sits. Throughout this spec, **cursor** means *structural cursor* (a focused node or node-range). The CodeMirror character caret is a separate concept, used only in insertion mode (§4).

1.4 Applies to the main editor by default. Tutorial playgrounds and other secondary editors (per [editor.md](editor.md) §1.13) may opt in.

1.5 The implementation should be re-built on a clean functional core: pure operations of type `(Tree, CursorSet) → (Tree, CursorSet)` with no side effects, fully unit-testable. CodeMirror integration is a thin adapter layer on top.

---

## 2. Ontology

2.1 The document parses to a **tree** via Lezer (`@nextjournal/clojure-mode`). Lezer is an error-recovering incremental parser: a tree always exists, even mid-typing, with `⚠` error nodes inserted where input cannot be reconciled.

2.2 Every node has two layers:
- **Core** — the structural identity. One of: `symbol`, `number`, `keyword`, `string`, `list`, `vector`, `map`, `set`, or the special `document` root.
- **Metas** — an ordered stack of `(kind, payload)` pairs decorating the core (§6). Metas are transparent to structural operations; they ride along with their host node.

2.3 **Leaves vs compounds.** `symbol`, `number`, `keyword`, `string` are leaves: no children. `list`, `vector`, `map`, `set` are compounds: an ordered sequence of child nodes. The `document` is a compound whose children are the top-level forms.

2.4 The **document root** is the unique node of kind `document`. It has no parent. It is reached when the user presses `nav.up` enough times. It supports bulk operations only (delete-all, cut-all, copy-all, select-all); slurp/barf/raise/wrap/splice/transpose targeted at the root are rejected with a no-op flash (§7.2).

2.5 **Error nodes.** A node with an error-node ancestor is structurally degraded:
- Navigation onto or past an error node is allowed — the user can move to the broken region.
- Mutations whose target node is inside an error region are rejected with a no-op flash.
- Errors in one branch of the tree do not poison operations elsewhere.

2.6 **Whitespace and line comments belong to the parent** as inter-child padding. They are not nodes. Structural mutations preserve the parent's padding pattern as faithfully as Lezer's reformatting rules allow. Both `;` line comments and `;;` form comments share this rule.

2.7 **`#_` ignore-form is a Meta**, not a comment (§6). The host form remains a first-class node visible to navigation, with an `ignore` Meta marking it. Ignored code stays visible in the document; its sole effect is that the runtime skips evaluation.

2.8 **Cursor identity is a stable tree-node handle**, not a character offset. The editor performs no character-offset arithmetic in structural mode; node start/end positions are queried from Lezer only when composing the underlying text edit for a mutation. This means cursors survive any text-edit that doesn't destroy their target node, regardless of how many characters shifted.

---

## 3. Cursors

3.1 A **cursor** is one of:
- A **node cursor** — a stable handle on one node in the tree.
- A **range cursor** — an ordered, contiguous run of two or more sibling nodes under a common parent.

3.2 The editor maintains a non-empty **cursor set**. Exactly one cursor in the set is the **primary**; the rest are **secondary**. Operations needing a single target (e.g. "scroll focused node into view") use the primary; mutating operations apply pointwise to every cursor in the set.

3.3 Cursors render as visual halos on their target node(s). No character caret, no underline, no glyph-level decoration. The CodeMirror text caret is **hidden** while in structural mode.

3.4 In v1 the default state is a single-cursor set. Multi-cursor support is part of the algebra — operations are defined to handle a set — but the UI gestures for building cursor sets are minimal in v1 (§9.1).

3.5 **Pointwise application with conflict resolution.** When a mutating operation fires with multiple cursors in the set:
- Cursors are applied in document order, leftmost first.
- After each application, surviving cursors are remapped to the post-mutation tree (their target nodes may have moved).
- If a later cursor's target was destroyed by an earlier application, that cursor is dropped from the set and a console note is emitted (suppressible).
- Operations against the document root are atomic; they do not interleave with sibling cursors.

3.6 **Cursor stability across edits.** After any text edit (structural or insertion-mode), every cursor's target is remapped to the corresponding node in the new tree. If a target no longer exists, the cursor relocates to the nearest surviving ancestor. If the document is now empty, the cursor relocates to the document root.

3.7 **Range cursor invariants.** A range's endpoints share a parent and are non-degenerate (length ≥ 2). A mutation that collapses a range to one node converts it to a node cursor. A mutation that destroys one endpoint relocates the range to remain valid, or collapses it.

---

## 4. Modes

4.1 The main editor has two modes of operation:
- **Structural** (default) — cursors act on the tree; the text caret is hidden; navigation walks nodes; mutations rewrite the tree.
- **Insertion** — the text caret is visible; standard text editing applies; structural cursors are paused and not rendered.

4.2 **Entering insertion mode** is triggered by:
- The explicit action `mode.insert`.
- Any operation that requires user-typed text to complete (e.g. `wrap.list` opens an empty `()` and places the caret at the operator position).
- Pressing a printable key while focused on a leaf whose contents the user could plausibly want to edit (typing into a focused symbol begins to rename it). This auto-entry is a setting (`structure.autoEnterInsertion`, default true).

4.3 **Exiting insertion mode** is triggered by:
- The explicit action `mode.structural`.
- The eval action (eval, then auto-return to structural).
- A configurable idle timeout (default disabled).

4.4 **Mode round-trip preserves cursor state.** Going structural → insertion → structural restores the cursor set as it was when insertion was entered, *unless* the entering text edit changed the tree such that some targets no longer exist (in which case §3.6 applies). The text caret position when entering insertion is derived from the primary cursor's target (typically just inside the opening bracket of a compound, or at the end of a leaf).

4.5 The current mode is rendered in the UI via a status indicator and the cursor style. The "spatial vs structural" gamepad navigation in [gamepad.md](gamepad.md) §1.3 is subordinate to the mode distinction defined here: gamepad **structural** nav engages §5.1 operations directly; gamepad **spatial** nav requires insertion mode.

---

## 5. The algebra

Operations have type `(Tree, CursorSet) → (Tree, CursorSet)`. Each operation states preconditions, post-conditions on the cursor set, and the no-op behaviour when preconditions fail.

### 5.1 Navigation

Tree unchanged; cursor set updated. All navigation operations apply pointwise to every cursor in the set.

5.1.1 `nav.up` — cursor moves to its target's parent. No-op flash at the document root.

5.1.2 `nav.down` — cursor moves to its target's first child. No-op flash on leaves and on empty compounds.

5.1.3 `nav.next` / `nav.prev` — move to the next / previous sibling under the same parent. No-op flash at the last / first sibling.

5.1.4 `nav.first` / `nav.last` — move to the first / last sibling under the same parent.

5.1.5 `nav.extendNext` / `nav.extendPrev` — converts a node cursor to a range cursor by absorbing the next / previous sibling, or extends an existing range cursor outward. No-op flash if no further sibling exists.

5.1.6 `nav.shrink` — releases the most-recently-added end of a range cursor; collapses to a node cursor when length reaches 1.

5.1.7 `nav.intoMeta` — descends from the host node into the payload of its outermost Meta (§6.7). Reverse is `nav.up`. No-op flash if the outermost Meta has no payload.

### 5.2 Mutation

All mutations apply pointwise across the cursor set per §3.5. The descriptions below are written for a single cursor; multi-cursor behaviour is the pointwise lift.

5.2.1 **Slurp forward** (`edit.slurpForward`). Precondition: cursor on a compound `L` that is not the document root. Action: `L`'s next sibling becomes `L`'s last child. Post-condition: cursor stays on `L`. No-op flash if `L` has no next sibling.

5.2.2 **Slurp backward** (`edit.slurpBackward`). Symmetric: `L`'s previous sibling becomes `L`'s first child.

5.2.3 **Barf forward** (`edit.barfForward`). Precondition: cursor on a compound `L` with at least two children. Action: `L`'s last child becomes `L`'s next sibling. Post-condition: cursor stays on `L`; the barfed node does not become focused. No-op flash if `L` has fewer than two children (use `edit.deleteContents` for the "empty the list" intent).

5.2.4 **Barf backward** (`edit.barfBackward`). Symmetric.

5.2.5 **Raise** (`edit.raise`). Precondition: cursor on a node `N` whose parent is not the document root. Action: `N` replaces its parent (the parent and its other children are removed). Post-condition: cursor moves to `N` in its new position.

5.2.6 **Splice** (`edit.splice`). Precondition: cursor on a compound `L` that is not the document root (splicing a top-level `do` form *into* the document root is fine — the root is `L`'s parent). Action: `L`'s children become siblings of `L` in the parent; `L` itself is removed. Post-condition: cursor moves to the **first** of the spliced children (rationale: pressing `nav.up` to reach the parent is one step; descending back into the spliced region from the parent is several).

5.2.7 **Wrap** (`edit.wrap.list`, `edit.wrap.vector`, `edit.wrap.map`, `edit.wrap.set`). Action: a fresh compound of the requested kind is created with `N` as its sole child, replacing `N` in the parent. Post-condition: cursor moves to the new wrapper. `edit.wrap.list` additionally enters insertion mode at the head position so the user can type the operator name.

5.2.8 **Transpose** (`edit.transposeNext` / `edit.transposePrev`). Action: swap the focused node with its next / previous sibling. Post-condition: cursor follows the focused node to its new position. No-op flash at sibling-boundary.

5.2.9 **Atom slurp.** Precondition: cursor on a leaf `A`. Default behaviour: `A` is auto-promoted to a singleton compound containing `A`, then the slurp proceeds as 5.2.1 / 5.2.2. The promotion target is governed by `structure.atomSlurpBehaviour ∈ { "promote-to-vector", "promote-to-list", "no-op" }`, default `"promote-to-vector"`.

5.2.10 **Range mutations.** All §5.2 mutations have range-cursor variants:
- `slurpForward / slurpBackward` on a range — adjust the outer end of the range; the range itself is unchanged in length, only its outer extent moves.
- `barfForward / barfBackward` on a range — release one end of the range as an outside sibling; the range shrinks by one.
- `raise` on a range — the parent is replaced by the range as siblings (the parent's other children are removed).
- `wrap` on a range — wraps the entire run as the new compound's children; cursor moves to the new wrapper.
- `transpose` on a range — swaps the range with the adjacent sibling group of equal length, or with a single sibling (taste call deferred — see §9.2).
- `splice` on a range — undefined in v1, see §9.2.

### 5.3 Document-root operations

5.3.1 `doc.deleteAll`, `doc.cutAll`, `doc.copyAll`, `doc.selectAll` — operate on the entire document. After delete/cut, the document is empty and the cursor sits on the now-empty document root. After select-all, the cursor set is replaced by a single cursor on the document root.

5.3.2 No structural mutations (slurp / barf / raise / wrap / splice / transpose) are valid when the cursor is on the document root (§2.4).

### 5.4 Mode operations

5.4.1 `mode.insert` — enter insertion mode at the position derived from the primary cursor.

5.4.2 `mode.structural` — exit insertion mode; rebuild the cursor set from the text caret position (snapping to the smallest containing node) per §4.4.

5.4.3 `mode.toggle` — toggle between the two.

---

## 6. Metas

6.1 A **Meta** is a `(kind, payload)` pair attached to a host node. Each node carries an ordered stack of Metas; stack order matches the textual surface, innermost first.

6.2 **Recognition sources.** A Meta is produced when one of these surfaces is matched:
- **Sigils** (`'`, `` ` ``, `~`, `~@`, `@`) — `kind` from the character; empty payload.
- **Metadata prefix** (`^X form`) — `kind = "metadata"`; payload = `X`.
- **Ignore-form** (`#_form`) — `kind = "ignore"`; empty payload.
- **Wrapper calls** — function calls whose head matches a recognised wrapper name. Recognition is the union of three sources:
  - The built-in registry: `structure.builtinWrappers` (initial defaults: `quant-eval`, `debug`, `time`; final list TBD).
  - Function definitions tagged with `^:annotation` (or equivalent marker) at definition time. The runtime exposes the recognised set via a query.
  - The user setting `structure.userWrappers` — a list of names (and optionally a per-name `:disabled` flag to suppress a built-in match).

6.3 **Stacking is significant.** `(debug 'foo)` is `foo` carrying a `quote` Meta then a `debug` Meta (innermost first). `'(debug foo)` is `(debug foo)` carrying a single `quote` Meta. The two are distinct trees.

6.4 **Visibility (the drawer).**
- **Always visible** (cannot be folded): source-native sigils (`'`, `` ` ``, `~`, `~@`, `@`) and `#_`. Folding these would hide canonical source characters.
- **Foldable, default folded**: `metadata` (`^X`).
- **Foldable, default visible**: wrapper Metas. A global `structure.foldAllWrappers` setting overrides per-kind defaults.
- Folded Metas render as a small badge or superscript glyph on the host node. Hovering or focusing reveals the underlying source text inline as a read-only preview.

6.5 **Transparency to structural ops.** All §5 operations act on the **core** of the focused node, ignoring its Metas. Metas ride along through every mutation: slurping `'foo` into `(bar)` produces `(bar 'foo)`; raising a node carries its Meta stack with it; barfing returns a node with its Metas intact.

6.6 **Operations on Metas.**
- `meta.add <kind>` — add a Meta of the given kind to the focused node (with a payload prompt for kinds that require one).
- `meta.remove` — remove the outermost Meta from the focused node.
- `meta.cycle` — advance the outermost Meta through a configurable cycle of kinds (default cycle: `quote → unquote → off`).
- `meta.foldToggle` — toggle drawer visibility for the focused node's Metas.

6.7 **Navigation into Meta payloads.** Metas with structured payloads (`metadata`, wrapper Metas with arguments) are entered with `nav.intoMeta` (§5.1.7); the cursor descends into the payload, and `nav.up` returns to the host. Sigil and `ignore` Metas have no payload and reject this op.

---

## 7. Failure modes

7.1 **Unparseable region.** When the cursor sits inside a Lezer error node, mutating ops are rejected with a no-op flash; navigation degrades to "skip out of the broken region to the next stable parse boundary." Insertion mode remains available and is the user's path back to a parseable state.

7.2 **No-op flash.** When a precondition fails, the operation does not modify the document or the cursor set. The UI emits a brief flash on the cursor's target halo and a console toast (suppressible via `structure.flashConsoleToasts = false`). The flash MUST NOT shift the cursor, scroll the viewport, or move the text caret.

7.3 **Cursor invalidation.** A cursor whose target is destroyed by an external edit (e.g. typed text in insertion mode that reshapes the parse) relocates to the nearest surviving ancestor per §3.6.

7.4 **Pre/post-condition invariants.** Every mutation operation must satisfy: (a) the document parses without new error nodes attributable to the operation, (b) the cursor set is non-empty and every cursor's target exists in the post-tree, (c) Metas on every surviving node are preserved. Implementations must assert these in development builds.

---

## 8. Inputs (informative)

8.1 This spec defines operations, not bindings. Concrete keyboard chords live in [keybindings.md](keybindings.md) under the `structure` and `navigation` action categories. Concrete gamepad bindings live in [gamepad.md](gamepad.md).

8.2 Both input devices reach the same algebra. A gamepad button bound to `edit.slurpForward` and a keyboard chord bound to the same action produce identical state transitions.

8.3 The "spatial vs structural" navigation modes in [gamepad.md](gamepad.md) §1.3 are reframed here: gamepad **structural** nav engages §5.1 operations directly; gamepad **spatial** nav requires entering insertion mode (§4). Once that mode boundary is rendered in the UI, the gamepad's per-mode D-pad behaviour falls out automatically.

---

## 9. Open / Deferred

9.1 **Multi-cursor UI.** The algebra supports cursor sets in v1, but the gestures for building them are minimal at first. Deferred candidates: "add cursor at next sibling," "add cursor at all matching forms by symbol name," "add cursor at every probe site," "add cursor at every form with a given Meta kind." The shape of these gestures is open.

9.2 **Range-cursor ambiguities.** Splice on a range cursor is undefined in v1 — options include (a) split into per-node splices applied in document order, (b) reject as a no-op flash, (c) treat the range as a virtual compound and splice that. Transpose on a range is similar (swap with sibling group of equal length, with single sibling, or with whatever fits). Defer until use cases force the choice.

9.3 **Projectional rendering details.** How folded Metas render (badge style, glyph, color), how the drawer is summoned (hover, focus, explicit toggle), and how multi-cursor halos disambiguate from primary-cursor halos are presentation-layer concerns. Tracked in `ALIGNMENT.md` rather than this spec.

9.4 **Wrapper-Meta marker.** Whether the runtime-side marker for opt-in is exactly `^:annotation`, a different keyword, or a richer descriptor (e.g. carrying display hints), is open. The query API the editor uses to enumerate marked wrappers needs to be defined alongside.

9.5 **Atom-promote target.** Default is `promote-to-vector`. Whether this is the right default — and whether a third option ("smart": vector inside a function-call list, list at the top level) makes sense — is contestable.

9.6 **Strings as compounds.** Treating string literals as leaves means structural ops can't sub-edit string contents. Whether strings should expose internal sub-structure (e.g. interpolation segments, format-string components) is open.

9.7 **Eval-result and probe follow-along.** Eval-result widgets and probes attached to a range follow that range through structural mutations via CodeMirror's mark behaviour, but the contract is currently implicit. Should be promoted to a normative line either here or in [code-evaluation.md](code-evaluation.md).

9.8 **Document-level transpose.** Whether `edit.transposeNext` on a top-level form (i.e. with the document root as parent) is a structural mutation or a doc-level op is fuzzy — it's structurally well-defined, but feels different in use. Ergonomic question, not a correctness one.
