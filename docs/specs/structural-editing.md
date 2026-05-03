# Structural editing and navigation

> Spec: ontology and algebra of structural coding in the main editor. Foundation for all keyboard- and gamepad-driven structure operations. Counterpart to [MAIN.md](MAIN.md).
> See also [editor.md](editor.md) §1.10 (which this spec elaborates), [keybindings.md](keybindings.md) for the action registry, [gamepad.md](gamepad.md) for input bindings.
>
> This spec defines what structural operations *mean*. Concrete keyboard chords and gamepad buttons live in the input specs; both reach the same operations defined here.

### Source files

**Core (pure functional tree + operations):**
- `src/editors/extensions/structure/core/index.ts` — core barrel export (tree types, cursor types, operations)
- `src/editors/extensions/structure/core/types.ts` — node kinds, cursor, Meta, tree types
- `src/editors/extensions/structure/core/nav.ts` — navigation operations (`nav.*`)
- `src/editors/extensions/structure/core/mutate.ts` — mutation operations (`edit.*`)
- `src/editors/extensions/structure/core/holes.ts` — hole node recognition and construction
- `src/editors/extensions/structure/core/traversal.ts` — tree traversal utilities

**Adapter (CodeMirror integration):**
- `src/editors/extensions/structure/adapter/extension.ts` — CodeMirror extension entry point
- `src/editors/extensions/structure/adapter/stateField.ts` — structural-mode state field
- `src/editors/extensions/structure/adapter/treeFromLezer.ts` — Lezer-to-internal-tree conversion (tree construction, §2.10)
- `src/editors/extensions/structure/adapter/dispatcher.ts` — operation dispatch bridge
- `src/editors/extensions/structure/adapter/applyOp.ts` — apply pure ops to CodeMirror state
- `src/editors/extensions/structure/adapter/nodeOverlays.ts` — cursor halo decorations
- `src/editors/extensions/structure/adapter/holeWidget.ts` — hole pill widget rendering
- `src/editors/extensions/structure/adapter/spatialNav.ts` — spatial navigation resolution (§5.1-A)
- `src/editors/extensions/structure/adapter/cursorFromSelection.ts` — text-caret-to-structural-cursor snapping
- `src/editors/extensions/structure/adapter/cursorPath.ts` — cursor path utilities
- `src/editors/extensions/structure/adapter/gamepadBridge.ts` — gamepad-to-structural-op bridge
- `src/editors/extensions/structure/adapter/printTree.ts` — debug tree printer

**Related:**
- `src/editors/holeFocusEmitter.ts` — `holeFocused` channel event publisher (§2.9.4)
- `src/editors/gamepadNavigation.ts` — gamepad navigation wiring
- `src/lib/keybindings/actions.ts` — action registry (`structure.*`, `navigation.*` categories)

---

## 1. Frame

1.1 Structural coding is a first-class mode of interacting with the document. The editor maintains a tree-shaped model of the source and exposes operations that move and mutate that tree directly. Users do not think in characters or lines while in this mode; they think in nodes.

1.2 This spec defines the **ontology** (what the tree is) and the **algebra** (what operations exist and how they compose). Input devices bind their controls to operations defined here. The same operation has the same effect regardless of which device triggered it.

1.3 Structural coding is **focus-primary**: the canonical state is which node(s) the user is on, not where a character cursor sits. Throughout this spec, **cursor** means *structural cursor* (a focused node or node-range). The CodeMirror character caret is a separate concept, used only in insertion mode (§4).

1.4 Applies to the main editor by default. Tutorial playgrounds and other secondary editors (per [editor.md](editor.md) §1.13) may opt in.

1.5 The implementation should be re-built on a clean functional core: pure operations of type `(Tree, CursorSet) → (Tree, CursorSet)` with no side effects, fully unit-testable. CodeMirror integration is a thin adapter layer on top. (See `src/editors/extensions/structure/core/` for the pure core, `src/editors/extensions/structure/adapter/` for the CodeMirror layer)

---

## 2. Ontology

2.1 The document parses to a **tree** via Lezer (`@nextjournal/clojure-mode`). Lezer is an error-recovering incremental parser: a tree always exists, even mid-typing, with `⚠` error nodes inserted where input cannot be reconciled. (See `src/editors/extensions/structure/adapter/treeFromLezer.ts`)

2.2 Every node has two layers: (See `src/editors/extensions/structure/core/types.ts`)
- **Core** — the structural identity. One of: `symbol`, `number`, `keyword`, `string`, `list`, `vector`, `map`, `set`, `hole`, or the special `document` root.
- **Metas** — an ordered stack of `(kind, payload)` pairs decorating the core (§6). Metas are transparent to structural operations; they ride along with their host node.

2.3 **Leaves vs compounds.** `symbol`, `number`, `keyword`, `string`, `hole` are leaves: no children. `list`, `vector`, `map`, `set` are compounds: an ordered sequence of child nodes. The `document` is a compound whose children are the top-level forms.

2.4 The **document root** is the unique node of kind `document`. It has no parent. It is reached when the user presses `nav.out` enough times. It supports bulk operations only (delete-all, cut-all, copy-all, select-all); slurp/barf/raise/enclose/splice/transpose targeted at the root are rejected with a no-op flash (§7.2). The radial menu's `Insert` verb against the document root is a special case: it appends as the last top-level child ([radial-menu.md §5.1.1](radial-menu.md)).

2.5 **Error nodes.** A node with an error-node ancestor is structurally degraded:
- Navigation onto or past an error node is allowed — the user can move to the broken region.
- Mutations whose target node is inside an error region are rejected with a no-op flash.
- Errors in one branch of the tree do not poison operations elsewhere.

2.6 **Whitespace and line comments belong to the parent** as inter-child padding. They are not nodes. Structural mutations preserve the parent's padding pattern as faithfully as Lezer's reformatting rules allow. Both `;` line comments and `;;` form comments share this rule.

2.7 **`#_` ignore-form is a Meta**, not a comment (§6). The host form remains a first-class node visible to navigation, with an `ignore` Meta marking it. Ignored code stays visible in the document; its sole effect is that the runtime skips evaluation.

2.8 **Cursor identity is a stable tree-node handle**, not a character offset. The editor performs no character-offset arithmetic in structural mode; node start/end positions are queried from Lezer only when composing the underlying text edit for a mutation. This means cursors survive any text-edit that doesn't destroy their target node, regardless of how many characters shifted.

2.9 **Holes.** A **hole** is a structural placeholder for content the user has not yet filled. Core fields: (See `src/editors/extensions/structure/core/holes.ts`, `src/editors/extensions/structure/adapter/holeWidget.ts`)
- `name: string` — display label (e.g. `"freq"`).
- `type: HoleType` — one of `'number' | 'symbol' | 'keyword' | 'expr' | 'string'`.

2.9.1 **Surface syntax.** Holes are written in source as `($ name :type)`. This is a parser-level convention — Lezer parses `($ freq :number)` as a three-element list, and the tree-construction step (§2.10) folds any list matching the shape `($ <symbol> <:keyword>)` into a `hole` leaf. The head symbol `$` is **reserved** by structural ontology; user code containing the literal symbol `$` is parsed as a hole. (A list whose head is `$` but whose shape is malformed — wrong arity, non-keyword type — becomes a regular `list` with a structural-warning diagnostic.)

2.9.2 **Atomicity.** Holes are leaves. Structural ops (§5) treat them as single units. The `name` and `type` core fields are not addressable by navigation or mutation — slurp/barf/raise/transpose act on the hole as a whole, never on its inner components. To change a hole's name or type, replace the hole entirely (typically via the radial menu, or hand-edit in insertion mode).

2.9.3 **Eval block.** A top-level form whose subtree contains any `hole` leaf MUST NOT be sent to the runtime. The eval pipeline emits an inline diagnostic at each unfilled hole position ("fill this hole first") and falls back to LKG per [MAIN.md §2.1](MAIN.md). Sibling top-level forms without holes evaluate normally — the gate is per-form, not per-document. See [code-evaluation.md §1.1](code-evaluation.md).

2.9.4 **Auto-chain integration.** When the cursor lands on a hole post-mutation, the editor publishes a `holeFocused` event on the contracts channel registry. (See `src/editors/holeFocusEmitter.ts`) The radial menu subscribes and re-opens scoped to the hole's `:type` (see [radial-menu.md §8.2](radial-menu.md)). Other consumers (keyboard hint UI, tutorial overlays) may subscribe.

2.9.5 **Rendering.** Holes are foldable, default folded, rendered as inline placeholder pills. The fold setting follows `structure.foldAllWrappers`. Cursor halos render around the pill, not around the underlying source. When unfolded (e.g. `mode.insert` for hand-editing the type), the source `($ freq :number)` becomes visible until structural mode resumes. The folded pill format is specified in §2.9.7.

2.9.6 **Holes vs Metas.** Holes are **not** wrapper-Metas. Live-edit, ignore, debug, and other wrapper-Metas (§6) decorate a *host node* — the wrapper is ornamentation; the host is what structural ops act on. A hole has no host: the wrapper *is* the entire form. Holes therefore live in the core kind union (§2.2), not the Metas stack.

2.9.7 **Hole pill format (MVP).** The folded pill renders as `[<type-tag>·<name>]` in a single inline element with a subtle background. The type tag is a 3-character abbreviation:

| `:type` | tag |
|---|---|
| `:number` | `num` |
| `:symbol` | `sym` |
| `:keyword` | `kwd` |
| `:string` | `str` |
| `:expr` | `exp` |

Examples (in source view above, in folded pill view below):

```
(osc ($ freq :number))      →   (osc [num·freq])
(slow ($ rate :number)
      ($ body :expr))       →   (slow [num·rate] [exp·body])
```

Type information is encoded inline in the glyph form rather than via colour, so the cue survives across themes and accessibility settings. The pill is selectable as a single unit and is itself the structural target of cursors and mutations (§2.9.2).

2.9.8 **Hole hint UI = pill glow only.** When a cursor is on a hole, the only visual is the standard cursor halo applied to the pill (§3.3 cursor halos; renders around the pill per §2.9.5). No tooltip, no status-bar line, no inline expansion — the pill format already encodes the type, and the auto-open / manual-open behaviour (§2.9.9) carries the affordance for filling. Quiet by design.

2.9.9 **Auto-open behaviour after `holeFocused`.** The radial menu opens scoped to the hole's `:type` ([radial-menu.md §8.2](radial-menu.md)). *When* it opens depends on how the cursor reached the hole:

- **Auto-chain (post-mutation cursor landing on a hole as the result of a verb commit)** — the menu opens **instantly** for typed holes (`:number`, `:symbol`, `:keyword`, `:string`). For `:number` the menu enters the numpad sub-mode directly (per [radial-menu.md §15.1.2](radial-menu.md)); for `:string` it enters T9; for `:symbol` and `:keyword` it opens the picking phase scoped per [radial-menu.md §8.2.1](radial-menu.md).
- **Auto-chain landing on an `:expr` hole or an unknown / untyped hole** — the menu **does not** auto-open. The chain pauses; the cursor sits on the hole pill (with halo); the user taps `Y` to summon the menu when ready. Rationale: the menu has nothing to narrow to (the §8.2.1 table maps `:expr` and `(none / unknown)` to `leftTabIdx = 0`), so opening a wide menu interrupts thought without adding value.
- **Manual navigation (the cursor reaches the hole via `nav.nextHole` / `nav.prevHole` / arrow navigation)** — the menu **does not** auto-open regardless of `:type`. The user taps `Y` to summon it. Rationale: the user is browsing or orienting; they choose when to commit. Once summoned, the menu opens scoped per §8.2.1 exactly as in the chain case.

The two carve-outs above mean the chain stops at `:expr` holes by design; the user fills them deliberately, and the chain resumes (instant auto-open) on the *next* hole the verb's commit lands the cursor on. This setting is fixed in MVP; if churn shows users want different behaviour, gate behind a setting `structure.holeAutoOpen ∈ { 'chain-typed-only' (default), 'chain-all', 'never' }`.

2.10 **Tree construction.** The Lezer tree is folded into the internal tree at parse time. Three pattern recognitions run in order: (See `src/editors/extensions/structure/adapter/treeFromLezer.ts`)
1. `($ <symbol> <:keyword>)` (a 3-element list with the literal head symbol `$`, a symbol second, and a keyword third) → `hole{name, type}` leaf.
2. `(<wrapper-name> ...)` whose head matches a registered wrapper (§6.2) → host node + wrapper-Meta.
3. Anything else → straight conversion to its core kind.

Recognition is structural, not textual: a list whose head is the literal symbol `$` becomes a hole regardless of formatting (whitespace, comments inside the list are still preserved per §2.6). The tree-construction step is a pure function of the Lezer parse tree.

---

## 3. Cursors

3.1 A **cursor** is one of:
- A **node cursor** — a stable handle on one node in the tree.
- A **range cursor** — an ordered, contiguous run of two or more sibling nodes under a common parent.

3.2 The editor maintains a non-empty **cursor set**. Exactly one cursor in the set is the **primary**; the rest are **secondary**. Operations needing a single target (e.g. "scroll focused node into view") use the primary; mutating operations apply pointwise to every cursor in the set.

3.3 Cursors render as visual halos on their target node(s). No character caret, no underline, no glyph-level decoration. The CodeMirror text caret is **hidden** while in structural mode. (See `src/editors/extensions/structure/adapter/nodeOverlays.ts`)

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

4.2 **Entering insertion mode** is triggered by: (See `src/editors/extensions/structure/adapter/stateField.ts`)
- The explicit action `mode.insert`.
- Any operation that requires user-typed text to complete (e.g. `enclose.list` opens an empty `()` and places the caret at the operator position — see §5.2.7).
- Pressing a printable key while focused on a leaf whose contents the user could plausibly want to edit (typing into a focused symbol begins to rename it). This auto-entry is a setting (`structure.autoEnterInsertion`, default true).

4.2.1 **Insertion mode is keyboard-only by intent.** Gamepads have no printable keys; a gamepad-only user has no path out of insertion mode short of a chord. Therefore:
- When the most recent input event came from a gamepad (tracked via `gamepadStateStore.lastInputAt` vs the keyboard's last-event timestamp), printable-key auto-entry (§4.2 third bullet) is suppressed regardless of `structure.autoEnterInsertion`.
- `enclose.list/vector/map/set` invoked from a gamepad context inserts an `($ body :expr)` hole as the sole child instead of opening an empty bracket pair and entering insertion mode. The user fills the hole via the radial menu's auto-chain, or via the numpad/T9 sub-mode ([radial-menu.md §14](radial-menu.md)).
- `mode.insert` is **not** bound in any default gamepad paradigm. Hand-rebinding it remains possible for power users mixing input devices.

The net rule: a gamepad-only user never lands in insertion mode by accident. Renaming a symbol or typing free text requires either a keyboard or the menu's text-entry sub-mode.

4.3 **Exiting insertion mode** is triggered by:
- The explicit action `mode.structural`.
- The eval action (eval, then auto-return to structural).
- A configurable idle timeout (default disabled).

4.4 **Mode round-trip preserves cursor state.** Going structural → insertion → structural restores the cursor set as it was when insertion was entered, *unless* the entering text edit changed the tree such that some targets no longer exist (in which case §3.6 applies). The text caret position when entering insertion is derived from the primary cursor's target (typically just inside the opening bracket of a compound, or at the end of a leaf).

4.5 The current mode is rendered in the UI via a status indicator and the cursor style. **Spatial navigation is the primary structural navigation mode** — the editor treats the buffer as a 2D grid and arrow/D-pad inputs (`nav.up`/`nav.down`/`nav.left`/`nav.right`) move through it, focusing the most appropriate and logical node at each step. Tree-level navigation (`nav.in`/`nav.out`/`nav.next`/`nav.prev`) is available as a secondary, explicit layer for users who need precise tree-walking. Gamepad paradigms bind their controls to these operations per [gamepad.md](gamepad.md); in insertion mode, D-pad and stick drive the character caret instead.

---

## 5. The algebra

Operations have type `(Tree, CursorSet) → (Tree, CursorSet)`. Each operation states preconditions, post-conditions on the cursor set, and the no-op behaviour when preconditions fail.

### 5.1 Navigation (see `src/editors/extensions/structure/core/nav.ts`)

Tree unchanged; cursor set updated. All navigation operations apply pointwise to every cursor in the set.

#### 5.1-A Spatial navigation (primary) (see `src/editors/extensions/structure/adapter/spatialNav.ts`)

Spatial navigation is the default way to move through code. The editor treats the buffer as a 2D grid — arrow keys and D-pad move through it, focusing the most appropriate and logical node at each step. This is how most users navigate most of the time; tree-level operations (§5.1-B) are the secondary, explicit layer.

5.1.1 **`nav.right` / `nav.left` — horizontal spatial navigation.** The cursor advances (`right`) or retreats (`left`) through a depth-first, left-to-right Euler-tour traversal of the tree. In this traversal, each compound node is visited twice — once before its children (**pre-order**) and once after (**post-order**) — while leaves are visited once. The rules for `right` are:

- On a compound in pre-order state → move to first child (enter).
- On a non-last child (leaf or compound) → move to next sibling.
- On the last child → move to parent; the parent transitions to post-order state.
- On a compound in post-order state → if it has a next sibling, move to that sibling (pre-order); if it is the last sibling, move to its parent (post-order); if the parent is the document root, the cursor lands on the root. No-op flash at the document root in post-order state (i.e. traversal is complete).

`left` is the exact reverse of `right`.

The cursor tracks its traversal phase (pre-order / post-order) per compound. When the cursor arrives at a compound via a non-spatial operation (`nav.next`, `nav.in`, `nav.out`, `nav.first`, `nav.last`, etc.), the phase resets to pre-order. When the cursor arrives via `nav.right` from the compound's last child (or via `nav.left` from the compound's first child), the phase is post-order.

5.1.2 **`nav.up` / `nav.down` — vertical spatial navigation.** The cursor moves to the structurally nearest node on the previous / next source line. Resolution rules:

- Identify the start line and column of the current focused node's source span.
- Find the nearest non-empty source line above (`up`) or below (`down`).
- On the target line, prefer the node whose source span overlaps the current node's column and is at the greatest nesting depth (innermost match).
- If no node on the target line overlaps the column, select the first node on that line at the shallowest nesting depth.
- No-op flash if there is no source line above/below (at first/last line of document).

#### 5.1-B Tree-level navigation (secondary)

Explicit tree-walking for when the user needs to navigate the logical structure rather than the visual layout. These operations are available alongside spatial navigation but are not the default directional bindings.

5.1.3 `nav.out` — cursor moves to its target's parent. No-op flash at the document root.

5.1.4 `nav.in` — cursor moves to its target's first child. No-op flash on leaves and on empty compounds.

5.1.5 `nav.next` / `nav.prev` — move to the next / previous sibling under the same parent. No-op flash at the last / first sibling.

5.1.6 `nav.first` / `nav.last` — move to the first / last sibling under the same parent.

5.1.7 `nav.extendNext` / `nav.extendPrev` — converts a node cursor to a range cursor by absorbing the next / previous sibling, or extends an existing range cursor outward. No-op flash if no further sibling exists.

5.1.8 `nav.shrink` — releases the most-recently-added end of a range cursor; collapses to a node cursor when length reaches 1.

5.1.9 `nav.intoMeta` — descends from the host node into the payload of its outermost Meta (§6.7). Reverse is `nav.out`. No-op flash if the outermost Meta has no payload.

5.1.10 `nav.nextHole` / `nav.prevHole` — advance the cursor to the next / previous `hole` leaf in document order (across all top-level forms). No-op flash if no hole exists. Used by the radial menu's auto-chain (when stepping between holes within an inserted form) and by the keyboard `Tab` / `Shift-Tab` actions for hole-jumping.

### 5.2 Mutation (see `src/editors/extensions/structure/core/mutate.ts`)

All mutations apply pointwise across the cursor set per §3.5. The descriptions below are written for a single cursor; multi-cursor behaviour is the pointwise lift.

5.2.1 **Slurp forward** (`edit.slurpForward`). Precondition: cursor on a compound `L` that is not the document root. Action: `L`'s next sibling becomes `L`'s last child. Post-condition: cursor stays on `L`. No-op flash if `L` has no next sibling.

5.2.2 **Slurp backward** (`edit.slurpBackward`). Symmetric: `L`'s previous sibling becomes `L`'s first child.

5.2.3 **Barf forward** (`edit.barfForward`). Precondition: cursor on a compound `L` with at least two children. Action: `L`'s last child becomes `L`'s next sibling. Post-condition: cursor stays on `L`; the barfed node does not become focused. No-op flash if `L` has fewer than two children (use `edit.deleteContents` for the "empty the list" intent).

5.2.4 **Barf backward** (`edit.barfBackward`). Symmetric.

5.2.5 **Raise** (`edit.raise`). Precondition: cursor on a node `N` whose parent is not the document root. Action: `N` replaces its parent (the parent and its other children are removed). Post-condition: cursor moves to `N` in its new position.

5.2.6 **Splice** (`edit.splice`). Precondition: cursor on a compound `L` that is not the document root (splicing a top-level `do` form *into* the document root is fine — the root is `L`'s parent). Action: `L`'s children become siblings of `L` in the parent; `L` itself is removed. Post-condition: cursor moves to the **first** of the spliced children (rationale: pressing `nav.out` to reach the parent is one step; descending back into the spliced region from the parent is several).

5.2.7 **Enclose** (`edit.enclose.list`, `edit.enclose.vector`, `edit.enclose.map`, `edit.enclose.set`). Action: a fresh compound of the requested kind is created with `N` as its sole child, replacing `N` in the parent. Post-condition: cursor moves to the new wrapper. `edit.enclose.list` from a keyboard context additionally enters insertion mode at the head position so the user can type the operator name; from a gamepad context it inserts a `($ head :symbol)` hole at the head position instead (§4.2.1). The radial menu's `wrapWith` verb ([radial-menu.md §5.1.3](radial-menu.md)) is a distinct operation — it produces `(picked target)` or `(target picked)` rather than the bare-bracket wrap defined here.

5.2.8 **Transpose** (`edit.transposeNext` / `edit.transposePrev`). Action: swap the focused node with its next / previous sibling. Post-condition: cursor follows the focused node to its new position. No-op flash at sibling-boundary.

5.2.9 **Atom slurp.** Precondition: cursor on a leaf `A`. Default behaviour: `A` is auto-promoted to a singleton compound containing `A`, then the slurp proceeds as 5.2.1 / 5.2.2. The promotion target is governed by `structure.atomSlurpBehaviour ∈ { "promote-to-vector", "promote-to-list", "no-op" }`, default `"promote-to-vector"`.

5.2.10 **Range mutations.** All §5.2 mutations have range-cursor variants:
- `slurpForward / slurpBackward` on a range — adjust the outer end of the range; the range itself is unchanged in length, only its outer extent moves.
- `barfForward / barfBackward` on a range — release one end of the range as an outside sibling; the range shrinks by one.
- `raise` on a range — the parent is replaced by the range as siblings (the parent's other children are removed).
- `enclose` on a range — encloses the entire run as the new compound's children; cursor moves to the new wrapper.
- `transpose` on a range — swaps the range with the adjacent sibling group of equal length, or with a single sibling (taste call deferred — see §9.2).
- `splice` on a range — undefined in v1, see §9.2.

5.2.11 **Fill hole** (`edit.fillHole`). Precondition: cursor on a `hole` leaf. Action: replace the hole with the supplied content (a `Tree` fragment passed as op argument). Post-condition: cursor on the inserted content, or on its first hole (in document order) if the inserted fragment itself contains holes. This is the underlying op the radial menu's verbs delegate to when the apply target is a hole ([radial-menu.md §8.5](radial-menu.md)). Handedness is irrelevant — a hole has no siblings-in-the-wrapper-sense; it is replaced wholesale.

### 5.3 Document-root operations

5.3.1 `doc.deleteAll`, `doc.cutAll`, `doc.copyAll`, `doc.selectAll` — operate on the entire document. After delete/cut, the document is empty and the cursor sits on the now-empty document root. After select-all, the cursor set is replaced by a single cursor on the document root.

5.3.2 No structural mutations (slurp / barf / raise / enclose / splice / transpose) are valid when the cursor is on the document root (§2.4).

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

6.5 **Transparency to structural ops.** All §5 operations act on the **core** of the focused node, ignoring its Metas. Metas ride along through every mutation: slurping `'foo` into `(bar)` produces `(bar 'foo)`; raising a node carries its Meta stack with it; barfing returns a node with its Metas intact. **Holes are not Metas** (§2.9.6); they are leaves with their own atomicity rules, and the transparency promise here applies unconditionally to every Meta kind.

6.6 **Operations on Metas.**
- `meta.add <kind>` — add a Meta of the given kind to the focused node (with a payload prompt for kinds that require one).
- `meta.remove` — remove the outermost Meta from the focused node.
- `meta.cycle` — advance the outermost Meta through a configurable cycle of kinds (default cycle: `quote → unquote → off`).
- `meta.foldToggle` — toggle drawer visibility for the focused node's Metas.

6.7 **Navigation into Meta payloads.** Metas with structured payloads (`metadata`, wrapper Metas with arguments) are entered with `nav.intoMeta` (§5.1.7); the cursor descends into the payload, and `nav.out` returns to the host. Sigil and `ignore` Metas have no payload and reject this op.

---

## 7. Failure modes

7.1 **Unparseable region.** When the cursor sits inside a Lezer error node, mutating ops are rejected with a no-op flash; navigation degrades to "skip out of the broken region to the next stable parse boundary." Insertion mode remains available and is the user's path back to a parseable state.

7.2 **No-op flash.** When a precondition fails, the operation does not modify the document or the cursor set. The UI emits a brief flash on the cursor's target halo and a console toast (suppressible via `structure.flashConsoleToasts = false`). The flash MUST NOT shift the cursor, scroll the viewport, or move the text caret.

7.3 **Cursor invalidation.** A cursor whose target is destroyed by an external edit (e.g. typed text in insertion mode that reshapes the parse) relocates to the nearest surviving ancestor per §3.6.

7.4 **Pre/post-condition invariants.** Every mutation operation must satisfy: (a) the document parses without new error nodes attributable to the operation, (b) the cursor set is non-empty and every cursor's target exists in the post-tree, (c) Metas on every surviving node are preserved. Implementations must assert these in development builds.

---

## 8. Inputs (informative)

8.1 This spec defines operations, not bindings. Concrete keyboard chords live in [keybindings.md](keybindings.md) under the `structure` and `navigation` action categories. Concrete gamepad bindings live in [gamepad.md](gamepad.md). (See `src/lib/keybindings/actions.ts`, `src/lib/keybindings/defaults.ts`)

8.2 Both input devices reach the same algebra. A gamepad button bound to `edit.slurpForward` and a keyboard chord bound to the same action produce identical state transitions.

8.3 The gamepad paradigms in [gamepad.md](gamepad.md) bind their D-pad and stick gestures to the operations defined in §5.1. (See `src/editors/extensions/structure/adapter/gamepadBridge.ts`, `src/editors/gamepadNavigation.ts`) In structural mode, the primary directional inputs (D-pad, left stick) drive spatial navigation (`nav.up`/`nav.down`/`nav.left`/`nav.right`); tree-level operations (`nav.out`/`nav.in`/`nav.next`/`nav.prev`) are available on secondary inputs or modifier chords. In insertion mode, directional inputs drive the character caret. The mode boundary (§4) determines which behaviour is active.

---

## 9. Open / Deferred

9.1 **Multi-cursor UI.** The algebra supports cursor sets in v1, but the gestures for building them are minimal at first. Deferred candidates: "add cursor at next sibling," "add cursor at all matching forms by symbol name," "add cursor at every probe site," "add cursor at every form with a given Meta kind." The shape of these gestures is open.

9.2 **Range-cursor ambiguities.** Splice on a range cursor is undefined in v1 — options include (a) split into per-node splices applied in document order, (b) reject as a no-op flash, (c) treat the range as a virtual compound and splice that. Transpose on a range is similar (swap with sibling group of equal length, with single sibling, or with whatever fits). Defer until use cases force the choice.

9.3 **Projectional rendering details.** How folded Metas render (badge style, glyph, color), how the drawer is summoned (hover, focus, explicit toggle), and how multi-cursor halos disambiguate from primary-cursor halos are presentation-layer concerns. Tracked in `ALIGNMENT.md` rather than this spec.

9.4 **Wrapper-Meta marker for user-defined wrappers.** Whether the runtime-side marker for opt-in is exactly `^:annotation`, a different keyword, or a richer descriptor (e.g. carrying display hints), is open. The query API the editor uses to enumerate marked wrappers needs to be defined alongside. Note: this question concerns *user-extensible* wrapper-Metas only; holes (§2.9) are first-class structural nodes and do not depend on this mechanism.

9.5 **Atom-promote target.** Default is `promote-to-vector`. Whether this is the right default — and whether a third option ("smart": vector inside a function-call list, list at the top level) makes sense — is contestable.

9.6 **Strings as compounds.** Treating string literals as leaves means structural ops can't sub-edit string contents. Whether strings should expose internal sub-structure (e.g. interpolation segments, format-string components) is open.

9.7 **Eval-result and probe follow-along.** Eval-result widgets and probes attached to a range follow that range through structural mutations via CodeMirror's mark behaviour, but the contract is currently implicit. Should be promoted to a normative line either here or in [code-evaluation.md](code-evaluation.md).

9.8 **Document-level transpose.** Whether `edit.transposeNext` on a top-level form (i.e. with the document root as parent) is a structural mutation or a doc-level op is fuzzy — it's structurally well-defined, but feels different in use. Ergonomic question, not a correctness one.

9.9 **Hole serialisation in non-Lezer contexts.** Tools that consume the document outside the editor (linters, formatters, doc generators) must handle `($ name :type)` as a parseable form. Some may want to round-trip through the internal tree's `hole` node kind; others will see the raw three-element list. The surface syntax `($ name :type)` is the canonical interchange.
