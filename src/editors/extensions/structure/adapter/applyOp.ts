/**
 * Apply a structural op against the editor's current core State and dispatch
 * the resulting changes back to CodeMirror.
 *
 * Strategy (round 2, per task brief):
 *   - If the op only changed the cursor (tree identity unchanged), dispatch
 *     just a `setStructState` effect.
 *   - If the op mutated the tree:
 *     1. Find which top-level form (document child) was affected by walking
 *        the new cursor's parent chain. If the change spans multiple
 *        top-level forms (rare; e.g. raise from the doc root) we re-render
 *        the entire document. This is intentionally coarse — minimal-diff
 *        edits are out of scope.
 *     2. Print the affected top-level form (or the whole document) and
 *        replace the corresponding source range in a CodeMirror transaction.
 *     3. After the transaction's doc-change re-parse, the state field
 *        refreshes the tree+idIndex with fresh ids, and `cursorPath` re-
 *        derives the cursor onto the new tree.
 *
 * Whitespace/comments inside the affected form are reformatted. Documented in
 * the run report.
 */

import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { Cursor, OpResult, State, Tree } from "../core/index.ts";
import { pathOf } from "../core/traversal.ts";
import { getAppSettings } from "../../../../runtime/appSettingsRepository.ts";
import { pathsFromCursorSet, rederiveCursors } from "./cursorPath.ts";
import { formatNode, printNode, printNodeWithBreaks } from "./printTree.ts";
import { indentRangeToFixedPoint } from "./indentFixedPoint.ts";
import { setStructState, structField } from "./stateField.ts";
import { treeFromLezer, type IdIndex } from "./treeFromLezer.ts";

interface NoOpEntry {
  cursor: Cursor;
  reason: string;
}

type NodePrinter = (n: import("../core/index.ts").Node) => string;

type AutoFormatStrategy = "off" | "reflow" | "indent-fixed-point";

function getAutoFormatStrategy(): AutoFormatStrategy {
  return getAppSettings().format.autoFormatStrategy;
}

function getNodePrinter(strategy: AutoFormatStrategy): NodePrinter {
  switch (strategy) {
    case "reflow":
      return (n) => formatNode(n, getAppSettings().format);
    case "indent-fixed-point":
      return printNodeWithBreaks;
    case "off":
    default:
      return printNode;
  }
}

/**
 * Run an op and dispatch the result. Returns true iff the editor changed
 * (cursor moved or doc edited).
 */
export function applyOp(
  view: EditorView,
  op: (s: State) => OpResult,
): boolean {
  const value = view.state.field(structField, false);
  if (!value) return false;

  const before = value.state;
  const result = op(before);

  // Surface no-ops to the console (UI flash is nice-to-have).
  if (result.noOps.length > 0) {
    for (const entry of result.noOps as ReadonlyArray<NoOpEntry>) {
      console.warn(
        "[structure] no-op:",
        entry.reason,
        "cursor:",
        entry.cursor,
      );
    }
  }

  const after = result.state;

  // Cursor-only update: tree identity unchanged.
  if (after.tree === before.tree) {
    if (after.cursors === before.cursors || cursorsEqual(before.cursors, after.cursors)) {
      return false;
    }
    view.dispatch({
      effects: setStructState.of({
        state: after,
        idIndex: value.idIndex,
        cursorPaths: pathsFromCursorSet(after.cursors, after.tree),
      }),
      scrollIntoView: true,
    });
    scrollPrimaryIntoView(view);
    return true;
  }

  // Tree changed — derive a text edit. Find the smallest top-level form
  // ancestor of the new primary cursor's focus that we can re-render.
  const affectedTopLevel = findAffectedTopLevelIndex(before.tree, after.tree);
  const strategy = getAutoFormatStrategy();
  const print = getNodePrinter(strategy);
  if (affectedTopLevel === null) {
    // Whole-doc rerender fallback.
    return dispatchWholeDocReplace(view, before, value.idIndex, after, print, strategy);
  }

  return dispatchTopLevelReplace(view, before, value.idIndex, after, affectedTopLevel, print, strategy);
}

/**
 * Build the new document text for a whole-doc replace, preserving the
 * inter-top-level whitespace from the original document (spec §2.1).
 *
 * Strategy:
 *   - Extract the original gaps (text between top-level form ranges) from the
 *     current doc using the `before` tree's idIndex.
 *   - Print each new top-level form individually.
 *   - Stitch the printed forms back together with the original gaps.
 *
 * When the number of top-level forms changes (e.g. splice, raise, enclose),
 * gaps are handled as follows:
 *   - If there are fewer new forms than old, trailing gaps are dropped.
 *   - If there are more new forms than old (e.g. barf/splice), the gap before
 *     each newly-created sibling form defaults to a single space — the sibling
 *     is released into the same line context as its origin (per §5.2.3).
 *
 * The text before the first form and after the last form is always preserved
 * from the original document.
 */
function buildDocWithPreservedGaps(
  docText: string,
  before: State,
  beforeIdIndex: IdIndex,
  after: State,
  print: NodePrinter,
): string {
  const oldChildren = before.tree.root.children;
  const newChildren = after.tree.root.children;

  // Collect original source ranges for the old top-level forms.
  const oldRanges: Array<{ from: number; to: number }> = [];
  for (const child of oldChildren) {
    const range = beforeIdIndex.get(child.id);
    if (range) {
      oldRanges.push(range);
    }
  }

  // Extract leading text (before the first old form).
  const leadingText =
    oldRanges.length > 0 ? docText.slice(0, oldRanges[0].from) : "";

  // Extract gaps between consecutive old forms.
  const gaps: string[] = [];
  for (let i = 0; i + 1 < oldRanges.length; i++) {
    gaps.push(docText.slice(oldRanges[i].to, oldRanges[i + 1].from));
  }

  // Extract trailing text (after the last old form).
  const trailingText =
    oldRanges.length > 0
      ? docText.slice(oldRanges[oldRanges.length - 1].to)
      : "";

  // If we couldn't resolve any old ranges, fall back to flat join.
  if (oldRanges.length === 0 || newChildren.length === 0) {
    return newChildren.map(print).join("\n");
  }

  // Print each new top-level form.
  const printed = newChildren.map(print);

  // Stitch: leading + form0 + gap0 + form1 + gap1 + … + formN + trailing.
  //
  // When a mutation creates a NEW top-level sibling (more new forms than old —
  // e.g. barf/splice/raise expelling a node to the top level) there is no
  // recorded inter-node gap for it. Such a sibling is released into the same
  // line context as its origin form, so the separator is a single space
  // (matching `(a b) c`, per structural-editing.md §5.2.3). We must NOT use the
  // double-newline default here, which would wrongly split a barfed node onto
  // its own paragraph. Genuine pre-existing gaps between distinct top-level
  // definitions are still preserved verbatim via `gaps[]`.
  const NEW_SIBLING_GAP = " ";
  let result = leadingText + printed[0];
  for (let i = 1; i < printed.length; i++) {
    // Use original gap when available; fall back to a single space for
    // newly-created siblings.
    const gap = i - 1 < gaps.length ? gaps[i - 1] : NEW_SIBLING_GAP;
    result += gap + printed[i];
  }
  result += trailingText;
  return result;
}

function dispatchWholeDocReplace(
  view: EditorView,
  before: State,
  beforeIdIndex: IdIndex,
  after: State,
  print: NodePrinter,
  strategy: AutoFormatStrategy,
): boolean {
  const docText = view.state.doc.toString();
  const text = buildDocWithPreservedGaps(docText, before, beforeIdIndex, after, print);
  const change: ChangeSpec = {
    from: 0,
    to: view.state.doc.length,
    insert: text,
  };
  view.dispatch({
    changes: change,
    userEvent: "structure.mutate",
    scrollIntoView: true,
  });
  // After dispatch, the state field will have re-parsed. Now move the
  // cursor focus by re-deriving it from the new state's path.
  setCursorFromState(view, after);
  if (strategy === "indent-fixed-point") {
    indentRangeToFixedPoint(view, 0, view.state.doc.length);
    setCursorFromState(view, after);
  }
  scrollPrimaryIntoView(view);
  return true;
}

function dispatchTopLevelReplace(
  view: EditorView,
  before: State,
  oldIdIndex: IdIndex,
  after: State,
  topLevelIndex: number,
  print: NodePrinter,
  strategy: AutoFormatStrategy,
): boolean {
  // Source range to replace = original range of the OLD tree's top-level
  // form at `topLevelIndex`. We look it up via the previous idIndex.
  const oldRoot = before.tree.root;
  const oldChild = oldRoot.children[topLevelIndex];
  if (!oldChild) {
    return dispatchWholeDocReplace(view, before, oldIdIndex, after, print, strategy);
  }
  const oldRange = oldIdIndex.get(oldChild.id);
  if (!oldRange) {
    return dispatchWholeDocReplace(view, before, oldIdIndex, after, print, strategy);
  }
  const newRoot = after.tree.root;
  const newChild = newRoot.children[topLevelIndex];
  if (!newChild) {
    // The mutation removed this top-level form. Whole-doc re-render covers
    // this rare case.
    return dispatchWholeDocReplace(view, before, oldIdIndex, after, print, strategy);
  }
  const text = print(newChild);
  const change: ChangeSpec = {
    from: oldRange.from,
    to: oldRange.to,
    insert: text,
  };
  view.dispatch({
    changes: change,
    userEvent: "structure.mutate",
    scrollIntoView: true,
  });
  setCursorFromState(view, after);
  if (strategy === "indent-fixed-point") {
    // Re-indent only the affected range. After the dispatch above, the new
    // range is [oldRange.from, oldRange.from + text.length).
    indentRangeToFixedPoint(view, oldRange.from, oldRange.from + text.length);
    setCursorFromState(view, after);
  }
  scrollPrimaryIntoView(view);
  return true;
}

/**
 * After a doc-change transaction, the state field re-parsed and re-derived
 * cursors from saved paths. But the *intended* paths come from the post-op
 * state (the ones we captured before dispatching). We need to overwrite the
 * field's value with the freshly-built tree + the intended cursor paths
 * mapped onto it.
 */
function setCursorFromState(view: EditorView, after: State): void {
  // Re-parse against the now-current doc to get the fresh tree + idIndex.
  const { tree, idIndex } = treeFromLezer(view.state);
  const intendedPaths = pathsFromCursorSet(after.cursors, after.tree);
  const cursors = rederiveCursors(intendedPaths, tree);
  view.dispatch({
    effects: setStructState.of({
      state: { tree, cursors },
      idIndex,
      cursorPaths: pathsFromCursorSet(cursors, tree),
    }),
  });
}

/**
 * Shallow semantic equality for CursorSets. Avoids dispatching a spurious
 * "cursor update" when the core returned a new object with the same content
 * (e.g. on a no-op mutation where the lift rebuilds the set from survivors).
 */
function cursorsEqual(
  a: import("../core/index.ts").CursorSet,
  b: import("../core/index.ts").CursorSet,
): boolean {
  if (!cursorEqual(a.primary, b.primary)) return false;
  if (a.secondaries.length !== b.secondaries.length) return false;
  for (let i = 0; i < a.secondaries.length; i++) {
    if (!cursorEqual(a.secondaries[i], b.secondaries[i])) return false;
  }
  return true;
}

function cursorEqual(a: Cursor, b: Cursor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.target === b.target;
  if (a.kind === "range" && b.kind === "range") {
    return a.parent === b.parent && a.start === b.start && a.end === b.end && a.anchor === b.anchor;
  }
  return false;
}

/**
 * Find the index (within the document's children) of the top-level form that
 * differs between `before` and `after`. Returns null if multiple top-level
 * forms differ (whole-doc fallback) or if the lengths differ (insertion or
 * deletion at top level).
 */
function findAffectedTopLevelIndex(before: Tree, after: Tree): number | null {
  const a = before.root.children;
  const b = after.root.children;
  if (a.length !== b.length) return null;
  let differing = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (differing !== -1) return null; // more than one differs
      differing = i;
    }
  }
  return differing === -1 ? null : differing;
}

/**
 * Move the CodeMirror selection to the start of the primary cursor's source
 * range so the user sees it in view. We re-read from the freshly updated
 * state field.
 */
function scrollPrimaryIntoView(view: EditorView): void {
  const value = view.state.field(structField, false);
  if (!value) return;
  const c = value.state.cursors.primary;
  const id = c.kind === "node" ? c.target : c.start;
  const range = value.idIndex.get(id);
  if (!range) return;
  const docLen = view.state.doc.length;
  const anchor = Math.max(0, Math.min(range.from, docLen));
  // Only move the selection if it isn't already inside the range, to avoid
  // spurious selection churn during keyboard typing.
  const sel = view.state.selection.main;
  if (sel.from < range.from || sel.from > range.to) {
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
  }
}

// Exported for tests / debugging.
export const _internals = {
  findAffectedTopLevelIndex,
  pathFor: pathOf,
};
