---
stability: stable
layer: cross-cutting
---

# Structural fuzzing

> Spec: deterministic fuzz coverage for structural editor command dispatch,
> focus resolution, and Lezer-to-core tree construction.
> See also [structural-editing.md](structural-editing.md), [editor.md](editor.md),
> and [input-dispatch.md](input-dispatch.md).

### Source files

- `test/structural-fuzz.test.mjs` - Mocha integration entrypoint.
- `test/helpers/structural-fuzz-worker.js` - deterministic fuzz worker.
- `src/editors/commands/editorCommandRouter.ts` - command-router surface under test.
- `src/editors/extensions/structure/adapter/treeFromLezer.ts` - parse-to-structural-tree surface under test.
- `src/editors/extensions/structure/adapter/stateField.ts` - structural cursor state under test.
- `src/editors/extensions/structure/adapter/cursorPath.ts` - cursor path derivation under test.

---

## 1. Frame

1.1 Structural fuzzing exists to discover intermittent editor failures that are hard to capture by hand: stale focus, invalid cursor IDs, invalid source ranges, command-router exceptions, and hangs while users move, cut, paste, and edit code.

1.2 The fuzz harness is not a replacement for the YAML semantic suite under `test/new_structural/`. YAML rows specify intended behaviour for known scenarios. Fuzzing asserts safety invariants across broad random command streams and reports replay data when an invariant fails.

1.3 Every fuzz run MUST be deterministic from its seed. A failure report MUST include enough information to rerun the same worker seed, case, step, and operation replay.

1.4 The default Mocha suite MUST remain small enough for routine `npm run test:mocha` usage. Larger campaigns are allowed through environment variables (section 5).

---

## 2. Fuzz Surface

2.1 The worker MUST create a real headless CodeMirror `EditorView` with:

- `@nextjournal/clojure-mode` parser/keymap extensions.
- CodeMirror history.
- `structField`.
- `deleteConfirmField`.

2.2 All editor-directed actions that correspond to app behaviour SHOULD route through `executeEditorCommand()`. Direct `view.dispatch()` is allowed only for selection seeding, because the fuzzer needs to produce backward selections and arbitrary caret positions.

2.3 The operation generator SHOULD cover:

- Structural navigation and mutation actions exposed by `KNOWN_ACTIONS`.
- Character-key paths for brackets, quotes, Backspace, Delete, and Enter.
- Text typing through `typeText`.
- Range replacement through `replaceRange`.
- Whole-document replacement through `replaceDocument`.
- Undo and redo.
- Clipboard-like copy, cut, and paste using an in-memory clipboard model.
- Command-router operations such as `deleteNode` and `adjustNumber`.

2.4 Input documents SHOULD include both valid and malformed source:

- Balanced lists, vectors, maps, sets, strings, holes, and live-edit wrappers.
- Comments and ignored forms.
- Unterminated strings.
- Unbalanced delimiters.
- Malformed hole and wrapper forms.
- Parser-recovery cases where Lezer emits error nodes.

---

## 3. Required Invariants

After every generated operation, the worker MUST assert the invariants below.

3.1 **CodeMirror selection bounds.** The main editor selection MUST remain within `0..doc.length`.

3.2 **Structural state presence.** `structField` MUST be present and readable.

3.3 **Unique node IDs.** Every structural node in the current tree MUST have a unique ID.

3.4 **Complete idIndex.** Every structural node MUST have exactly one source range in `idIndex`, and `idIndex` MUST NOT retain stale entries for nodes no longer in the tree.

3.5 **Valid source ranges.** Every range MUST be integer-valued, non-inverted, and inside `0..doc.length`.

3.6 **Parent containment.** Every child range MUST be contained within its parent range. Parser-recovery nodes whose Lezer range escapes the parent MUST NOT become structural children.

3.7 **Sibling order.** Child ranges SHOULD be non-decreasing in source order.

3.8 **Cursor validity.** The primary cursor and all secondary cursors MUST point to nodes that exist in the current tree and have source ranges.

3.9 **Range cursor validity.** A range cursor's start and end nodes MUST share the cursor parent, and the start index MUST be less than or equal to the end index.

3.10 **Cursor path derivation.** `pathsFromCursorSet()` MUST NOT throw for the current cursor set and tree.

3.11 Any violation is a bug unless the invariant is itself shown to be too strong for the spec in [structural-editing.md](structural-editing.md). Do not weaken an invariant just to make a fuzz seed pass.

---

## 4. Failure Reports

4.1 A failure MUST print:

- `seed`
- `case`
- `step`
- failing operation
- document before the operation
- document after the operation, if any
- full replay array for that case
- stack trace or assertion message

4.2 The first response to a new failure SHOULD classify it as one of:

- **Command-router failure** - a user action throws or composes an invalid CodeMirror transaction.
- **Focus/cursor failure** - structural cursor IDs or paths no longer resolve.
- **Tree-construction failure** - `treeFromLezer()` produces impossible ranges or stale IDs.
- **Harness bug** - replay operation generation violates a contract no real caller can violate.
- **Semantic discovery** - behaviour is safe but exposes an undefined or underspecified editor semantic.

4.3 Fixes for command-router, focus, and tree-construction failures SHOULD include a focused regression test outside the random harness when the minimal repro is small and stable.

4.4 If a failure is valid but too large to fix immediately, create an `ergo` task with the replay and seed details. Do not leave only console output or markdown notes as the tracker.

---

## 5. Running

5.1 Default CI-sized run:

```bash
npx mocha test/structural-fuzz.test.mjs
```

5.2 Single-seed worker run:

```bash
STRUCTURAL_FUZZ_SEED=4 STRUCTURAL_FUZZ_CASES=64 STRUCTURAL_FUZZ_STEPS=250 \
  node test/helpers/structural-fuzz-worker.js
```

5.3 Multiple Mocha seeds:

```bash
STRUCTURAL_FUZZ_SEEDS=1,2,3,4 npx mocha test/structural-fuzz.test.mjs
```

5.4 Wider local campaign:

```bash
for seed in 1 2 3 4 5 6 7 8; do
  STRUCTURAL_FUZZ_SEED="$seed" STRUCTURAL_FUZZ_CASES=64 STRUCTURAL_FUZZ_STEPS=250 \
    node test/helpers/structural-fuzz-worker.js || exit $?
done
```

5.5 Environment variables:

| Variable | Meaning |
|---|---|
| `STRUCTURAL_FUZZ_SEED` | Single worker seed. |
| `STRUCTURAL_FUZZ_SEEDS` | Comma-separated Mocha seed list. |
| `STRUCTURAL_FUZZ_CASES` | Number of documents/cases per seed. |
| `STRUCTURAL_FUZZ_STEPS` | Number of operations per case. |
| `STRUCTURAL_FUZZ_MAX_DOC_LENGTH` | Soft length cap before the worker resets the document. |

---

## 6. Known Bug Classes Captured

6.1 **Stale/backward selection through command router.** Structural edits can leave CodeMirror selections in backward or stale shapes. Router-managed edits must normalize and clamp selections/ranges before composing CodeMirror changes. Covered by the default fuzz seeds and `src/editors/bracketProtection.test.ts`.

6.2 **Malformed Lezer children escaping parent ranges.** Parser-recovery nodes can have ranges that extend beyond their parent syntax node. Tree construction must not attach those escaped children to the structural tree. Covered by `src/editors/extensions/structure/adapter/__tests__/malformedRanges.test.ts`.

---

## 7. Maintenance Rules

7.1 Add new operations to the fuzzer when new editor commands become part of normal user workflows.

7.2 Keep random generation biased toward realistic live-editing streams: short command bursts, malformed intermediate text, undo/redo, and selection changes.

7.3 Prefer increasing seed coverage over increasing only step count. Different seeds explore different document shapes and operation distributions.

7.4 Do not make the default Mocha run expensive. Put long campaigns behind explicit environment variables or shell loops.

7.5 When the fuzzer discovers a stable minimal document, add a focused unit/regression test in the relevant module as well as keeping the fuzz seed in circulation.
