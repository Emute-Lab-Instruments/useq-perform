---
stability: evolving
layer: behavioural
---

# Operator Modifier UI

> Spec: how the editor discovers, presents, and source-rewrites attached
> operator modifiers. Language authority lives in
> [../../src-useq/docs/specs/operator-modifiers.md](../../src-useq/docs/specs/operator-modifiers.md);
> qualified identity remains orthogonal under
> [../../src-useq/docs/specs/qualified-symbols.md](../../src-useq/docs/specs/qualified-symbols.md).

## Source files

- `src/lib/referenceDataLoader.ts` — loads generated callable inventory data.
- `src/utils/referenceStore.ts` — normalized reference-entry shape.
- `src/editors/extensions/structure/adapter/printTree.ts` — source formatter.
- `src/lib/pickerMenuModel.ts` — shared picker behavior.
- `src/editors/commands/editorCommandRouter.ts` — source-rewrite command
  dispatch.

---

## 1. Frame

1.1 Visible source is canonical. Modifier UI reads the attached block from the
call head and changes a modifier only by one visible, undoable source rewrite.
It MUST NOT keep an adapter namespace or modifier selection in parallel editor
state.

&nbsp;&nbsp;&nbsp;&nbsp;**Why:** evaluation, persistence, undo, and collaboration
must all observe the same declaration.

1.2 The generated canonical callable inventory is the only authority for base
identity, defaults, applicable facets, conflicts, options, option rates, and
descriptions. The editor MUST NOT own a second modifier list or applicability
algorithm.

1.3 Qualification is orthogonal. In `osc/sine[raw]`, the base span is the
whole `osc/sine` token and the attached block is the modifier span. Modifier UI
never adds, removes, splits, or reinterprets `/`.

---

## 2. Recognition and Presentation

2.1 The editor recognizes a modifier span only for an attached block on a call
head. `sin[uni]` has a modifier span; `sin [uni]` has a symbol followed by an
ordinary vector and receives no modifier affordance.

2.2 Hover or reference help for a modified head shows:

- the exact resolved base identity;
- the fixed effective facets and options after defaults/raw baseline merge;
- which entries were explicit in source; and
- the declared meaning and rate of each option.

2.3 Unknown bases and malformed blocks receive no guessed affordance. Compiler
diagnostics remain authoritative.

---

## 3. Picker and Completion

3.1 The modifier picker lists only facets and options applicable to the exact
resolved base. It marks explicit entries separately from inherited defaults.

3.2 Choosing a facet adds, replaces, or removes the corresponding visible
entry in one structural transaction. The picker prevents duplicate and
conflicting explicit facets; it does not silently repair malformed source.

3.3 Choosing an option inserts its keyword and one editable expression. For
`pulse`, the picker exposes signal-rate `:duty` and its declared `0.5` default;
it produces source such as `pulse[bi :duty 0.2]`.

3.4 Completion may suggest attached modifier blocks after an exact callable
base. It MUST NOT suggest adapter-qualified spellings such as `lfo/sin` or
`b/sin`.

3.5 User gestures never auto-accept a modifier or rewrite qualification.

---

## 4. Formatting

4.1 Formatting preserves attachment: there is no whitespace between the exact
base and `[`, entries use single spaces, and there is no padding immediately
inside the brackets.

```lisp
sin[uni norm]
pulse[bi :duty 0.2]
osc/sine[raw]
```

4.2 Facet entries are unordered semantically. The formatter preserves authored
entry order; it does not use ordering as semantics or sort an option away from
its value expression.

4.3 Formatting does not add, remove, or replace facets/options and does not
rewrite qualification. It runs only where [formatting.md](formatting.md) gives
the formatter ownership; it never rewrites untouched loaded source or fights
the user while typing.

---

## 5. Normative UI Witnesses

5.1 Editor tests MUST distinguish and preserve:

```lisp
sin[uni norm]
sin[norm uni]          ; same effective OperatorSpec, preserved source order
pulse[bi :duty 0.2]
sin[lfo bi]
sin[uni]               ; attached modifier
sin [uni]              ; ordinary vector argument
left/gain              ; exact qualified binding, not modifier UI
right/gain             ; same local segment, distinct exact qualifier
```

5.2 Tests MUST cover malformed blocks, duplicate/conflicting facets, unknown
and inapplicable entries, missing/duplicate options, and the absence of
modifier UI on spaced vectors.

## Open / Deferred

- **Migration quick fixes.** The engine may diagnose rejected adapter
  spellings; whether the editor offers an explicit one-click source migration
  remains undecided.
