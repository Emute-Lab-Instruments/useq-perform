# Formatting

> Spec: auto-formatting policy for the structural editor. Defines when the
> editor reformats code, what "well-formatted" means for ModuLisp in a live
> performance context, and how user formatting intent is preserved.
>
> See also [structural-editing.md](structural-editing.md) §2.6 (whitespace
> ownership), [editor.md](editor.md) §1.10 (structural editing stack).

### Source files

- `src/editors/extensions/structure/adapter/printTree.ts` — tree-to-source printer: flat `printNode` + formatting-aware `formatNode` (width + complexity thresholds, arg-aligned breaking, `do`-block rules)
- `src/editors/extensions/structure/adapter/applyOp.ts` — dispatches structural mutations to CodeMirror

---

## 1. Principles

1.1 **The buffer is a patch bay, not a source file.** In live performance, the
spatial layout of the buffer IS the primary navigation interface. The performer
groups top-level forms by function (outputs, state, commands) and uses vertical
whitespace to separate those groups visually. This layout is semantic intent.

1.2 **Structural mutations own their output formatting.** When the editor
produces code via a structural operation (slurp, barf, enclose, raise, splice,
transpose, fill-hole), the user did not type that whitespace — the editor did.
The editor is responsible for producing readable output.

1.3 **Insertion mode preserves user intent.** When the user types code in
insertion mode and returns to structural mode, the editor does not reformat
what they typed. The user chose that layout.

1.4 **Legibility under performance pressure.** Formatting rules are tuned for
fast scanning at a glance — not for aesthetic beauty or maximum information
density. When in doubt, prefer the layout that makes argument boundaries and
nesting depth immediately visible.

---

## 2. Scope of Formatting

### 2.1 Inter-top-level whitespace: sacred

The editor MUST NOT alter whitespace between top-level forms (children of the
document root). Blank lines, multiple blank lines, and comment lines between
top-level forms are preserved exactly as the user wrote them.

**Exception — structural ops that change top-level structure:**
- `edit.splice` on a top-level `do` block: the children become new top-level
  forms. They are separated by single blank lines (the `do` block's internal
  formatting no longer applies at the top level). The whitespace before and
  after the original `do` block is preserved.
- `edit.raise` from inside a top-level form: the raised node becomes a new
  top-level form. It inherits the whitespace slot of the form it replaced.
- `edit.enclose` on multiple top-level forms: the new wrapper inherits the
  whitespace slot of the first enclosed form; whitespace between the enclosed
  forms becomes internal formatting (subject to §3).

### 2.2 Intra-form formatting: editor-managed after mutations

After any structural mutation, the affected top-level form is reformatted
according to §3. "Affected" means the top-level form containing the mutation
target (or the entire document for operations that span multiple top-level
forms).

### 2.3 Insertion mode exits: hands off

When `mode.structural` fires (exiting insertion mode), the editor does NOT
reformat. The user's typed layout is preserved. The tree is rebuilt from the
source as-is.

### 2.4 Loaded code: hands off

Code loaded from any source — localStorage autosave, URL gist, snippet
insertion, clipboard paste — is NOT reformatted on load. The user's (or
author's) existing layout is preserved until the first structural mutation
targeting that form. Rationale: reformatting on load would produce a jarring
layout shift on every session start, and would destroy the performer's
carefully-arranged patch layout.

### 2.5 Explicit reformat command

An explicit `format.topLevel` action reformats the top-level form containing
the primary cursor per §3. An explicit `format.document` action reformats all
top-level forms (without touching inter-top-level whitespace). These are
opt-in; they are not triggered by any implicit gesture.

### 2.6 `format.autoFormatOnMutation = false`

When auto-formatting is disabled, structural mutations still produce source
text (they must — the tree changed), but the printer uses minimal formatting:
single spaces between siblings, no line breaks within forms. This is the
current behaviour of `printTree.ts`. It is intentionally *flat*, not
*layout-preserving* — preserving the old layout across a tree mutation is a
harder problem (the old source offsets no longer correspond to the new tree)
and is out of scope. Users who disable auto-format accept flat output from
mutations and use the explicit reformat command (§2.5) when they want
readable layout.

---

## 3. Formatting Rules

### 3.1 Single-line preference

A form is printed on a single line when it is **below both thresholds**:
- **Width threshold**: the printed single-line form is ≤ `format.lineWidth`
  characters (default: 60).
- **Complexity threshold**: no child exceeds the complexity budget (§3.2).

If either threshold is exceeded, the form breaks per §3.3.

### 3.2 Complexity model

Each node has a **weight**:
- Leaf (symbol, number, keyword, string, hole): weight = 1
- Compound with only leaf children: weight = 2
- Compound with any compound child: weight = 2 + max(child weights)

A form breaks when **any** of:
- Its total printed width exceeds `format.lineWidth`.
- It has a child with weight ≥ `format.complexityThreshold` (default: 4).
- It is a `do` block with more than one child (§3.5).

The complexity threshold captures the user's example: `(+ 0.1 0.2 0.3 0.4)`
has weight-1 children (all leaves) — stays on one line regardless of arg
count. But `(+ (usin bar) (seq [1 2 3 4] (slow (from-list [3 2 4] (slow 8 bar)) bar)))`
has a deeply nested child (weight ≥ 4) — triggers breaking.

**Breadth vs depth.** The complexity model is intentionally depth-sensitive,
not breadth-sensitive. A form with many leaf children (`(+ 1 2 3 4 5 6 7 8)`)
stays on one line unless it exceeds the width threshold — many simple args in
a row is perfectly readable. Width is the only gate for broad-but-shallow
forms. The complexity threshold only fires on *nesting depth*, which is what
actually makes argument boundaries hard to see at a glance.

### 3.3 Breaking strategy

When a form breaks, the printer applies **arg-aligned indentation**:

```
(<head> <arg1>
        <arg2>
        <arg3>)
```

The first argument stays on the same line as the head symbol. Subsequent
arguments are indented to align with the first argument. Each argument is
itself recursively formatted (it may stay on one line or break further).

**Special case — head is itself a compound** (rare but legal): use 2-space
body indent instead:

```
((computed-fn arg)
  <arg2>
  <arg3>)
```

### 3.4 Recursive breaking

Breaking is applied recursively. Each child is independently measured against
the thresholds. A child's available width is `format.lineWidth` minus its
indentation column. If the child's single-line rendering exceeds its available
width, it breaks.

**Minimum available width floor.** When arg-aligned indentation pushes a
child past column `format.lineWidth - format.minAvailableWidth` (default:
20), the formatter falls back to 2-space body indent for that parent instead
of arg-alignment. This prevents deeply nested forms from being crushed into
an unusably narrow column. The fallback is local — only the form whose
alignment would violate the floor switches to body indent; its ancestors
keep their alignment.

Example (arg-aligned, floor not triggered):
```
(a1 (+ (usin bar)
        (seq [1 2 3 4]
             (slow (from-list [3 2 4]
                              (slow 8 bar))
                   bar))))
```

Here `seq` broke because its second argument (the `slow` call) is complex.
The `slow` broke because `from-list` is complex. `from-list` broke because
at its indentation depth, the single-line form would exceed the width limit.
The inner `(slow 8 bar)` stays on one line — it's short and simple.

Example (floor triggered — if `from-list`'s arg-aligned column would leave
< 20 chars available, it falls back to body indent):
```
(a1 (+ (usin bar)
        (seq [1 2 3 4]
             (slow (from-list [3 2 4]
                     (slow 8 bar))
                   bar))))
```

### 3.5 `do` blocks

`do` blocks ALWAYS break their children onto separate lines, regardless of
width or complexity, with 2-space indent:

```
(do
  (bpm 120)
  (define p (phasor 4))
  (a1 (osc (* 440 p)))
  (d1 (pulse p)))
```

Rationale: `do` children are logically separate statements. A single-line `do`
block is never easier to read than a broken one.

### 3.6 Vectors and maps as data

Vectors `[...]` and maps `{...}` used as literal data (e.g. `[1 2 3 4]`,
`[0.1 0.5 0.9]`) follow the same threshold rules but tend to stay on one
line in practice because their children are usually leaves. When they do
break, they use 1-space indent from the opening bracket:

```
[1 2 3 4 5 6 7 8
 9 10 11 12]
```

### 3.7 Metas and wrappers

Meta-wrapped forms ([structural-editing.md §6](structural-editing.md)) are
formatted with the **host form's complexity determining the layout**. The
formatter measures width and complexity of the host node, not the wrapper
surface syntax.

**Sigil Metas** (`'`, `` ` ``, `~`, `~@`, `@`, `#_`) are single-character
prefixes; they add negligible width and never cause a break on their own:

```
'(slow 4 (osc 440))      ;; formatted same as the unwrapped form
#_(d2 (pulse bar))        ;; ignored form, same layout rules
```

**Wrapper-call Metas** (`live-edit`, `debug`, `time`, user wrappers) are
function-call-shaped: `(<wrapper> <host> <keyword-args...>)`. These wrappers
always contain a leaf literal as their host (see [live-edit.md §2.1](live-edit.md)),
so they are typically short and stay on one line:

```
(live-edit 0.5 :id "abc" :min 0 :max 1)
(live-edit 120 :id "bpm1" :min 60 :max 200 :name "tempo")
```

**`live-edit` wrappers are always single-line.** Unlike other wrapper-calls,
`live-edit` forms MUST NOT break across lines. The inline widget replaces the
entire wrapper source with a `Decoration.replace()` (see [live-edit.md §4.1](live-edit.md)),
and CodeMirror forbids replace decorations from spanning line breaks when
provided via a StateField plugin. A multi-line wrapper would crash the editor.
The formatter treats the wrapper as occupying a fixed estimated width (~6–8
character widths, since the rendered widget replaces the hidden source text)
rather than counting the hidden source characters. If keyword args would push
the source text past `format.lineWidth`, the formatter still keeps the wrapper
on one line — the user sees the compact widget, not the source text.

Other wrapper-calls (`debug`, `time`, user wrappers) without inline replace
decorations follow the general rule: when they exceed `format.lineWidth`, they
break at keyword boundaries with arg-aligned indent:

```
(debug 0.5 :id "abc" :min 0 :max 1
             :name "cutoff" :step 0.01 :precision 3)
```

The structural editor folds wrapper Metas by default (replacing them with
inline widgets), so the formatter's output for wrappers is primarily relevant
in insertion mode or when `structure.foldAllWrappers` is false.

### 3.8 `define` and binding forms

`(define <name> <value>)` uses body indent (2-space) when the value breaks:

```
(define p (phasor 4))

(define melody
  (seq [1 2 3 4 5 6 7 8]
       (slow 4 bar)))
```

The binding name always stays on the first line with `define`. The value
expression is formatted per §3.1–§3.4 at its indentation level.

---

## 4. Preservation Rules

### 4.1 User newlines in insertion mode

When the user manually adds newlines inside a form in insertion mode, those
newlines are preserved until the next structural mutation affecting that form.
The structural mutation triggers a full reformat of the affected form per §3.

### 4.2 Comments

Line comments (`;`) inside forms are preserved in their relative position.
When a form is reformatted, a comment that was on the same line as an argument
stays on the same line; a comment on its own line stays on its own line
(indented to the current level).

### 4.3 Multiple consecutive blank lines within forms

Within a form, multiple consecutive blank lines are collapsed to a single
blank line during reformatting. (Between top-level forms, they are sacred
per §2.1.)

---

## 5. Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `format.lineWidth` | number | 60 | Maximum line width before breaking |
| `format.complexityThreshold` | number | 4 | Node weight at which a parent must break |
| `format.minAvailableWidth` | number | 20 | Floor: fall back to body indent when alignment would leave fewer chars than this |
| `format.indentStyle` | `"align" \| "fixed"` | `"align"` | `align`: args align to first arg. `fixed`: 2-space indent always |
| `format.autoFormatOnMutation` | boolean | true | Reformat after structural mutations |

5.1 `format.indentStyle = "fixed"` is provided for narrow displays or user
preference. It produces:

```
(a1
  (+ (usin bar)
    (seq [1 2 3 4]
      (slow
        (from-list [3 2 4]
          (slow 8 bar))
        bar))))
```

---

## 6. Interaction with Other Systems

6.1 **Eval.** Formatting is purely visual. The evaluator receives the full
source text as-is; formatting changes are whitespace-only and have no effect
on evaluation semantics.

6.2 **Visualisation/probes.** Probe positions are tracked by node identity,
not character offset. Reformatting does not displace probes.

6.3 **Autosave.** Formatting changes (from structural mutations) are part of
the document and are autosaved normally.

6.4 **Undo.** A structural mutation + its reformatting are a single undo step.
The user undoes the whole operation, not the formatting separately.

6.5 **Secondary editors.** Tutorial playgrounds and snippet previews that opt
into the structural editing stack use the same formatter. Read-only secondary
editors (help guide code examples) render source as-provided and do not
reformat. The formatter has no dependency on main-editor singletons — it is a
pure function of (tree, settings) and can be called from any editor context.

6.6 **Inspector scenarios.** The Inspector dev tool
([inspector.md](inspector.md)) exercises editor scenarios in isolation. It uses
the same `printTree` function. Formatting consistency between the Inspector and
the main editor is required — if the Inspector shows different layout for the
same tree, that's a bug.

---

## 7. Open / Deferred

7.1 **Tuning the defaults.** The default `lineWidth` of 60 and
`complexityThreshold` of 4 are initial estimates. Real-world performance use
will reveal whether these are too aggressive or too conservative. Expect
adjustment after user testing.

7.2 **Comment placement heuristics.** The exact rules for where comments land
after reformatting (§4.2) need refinement once real comment-heavy performance
code is studied.

7.3 **Parinfer-style continuous formatting.** Whether the editor should
subtly adjust indentation as the user types in insertion mode (without moving
content, just adjusting leading whitespace on new lines) is open. This would
give the user visual feedback about nesting depth while typing, without the
jarring content-shift of full reformatting.

7.4 **Format-on-eval.** Whether evaluating a top-level form should trigger
reformatting (as a "commit point" for the form's layout) is a possible future
addition. Currently excluded — eval is frequent enough that it would feel
intrusive.
