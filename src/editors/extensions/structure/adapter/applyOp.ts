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

import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { Cursor, NodeId, OpResult, State, Tree } from "../core/index.ts";
import { pathOf } from "../core/traversal.ts";
import { pathsFromCursorSet } from "./cursorPath.ts";
import { printNode } from "./printTree.ts";
import { setStructState, structField } from "./stateField.ts";
import { treeFromLezer } from "./treeFromLezer.ts";

interface NoOpEntry {
  cursor: Cursor;
  reason: string;
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
  if (affectedTopLevel === null) {
    // Whole-doc rerender fallback.
    return dispatchWholeDocReplace(view, after);
  }

  return dispatchTopLevelReplace(view, value.idIndex, after, affectedTopLevel);
}

function dispatchWholeDocReplace(view: EditorView, after: State): boolean {
  const text = printNode(after.tree.root);
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
  scrollPrimaryIntoView(view);
  return true;
}

function dispatchTopLevelReplace(
  view: EditorView,
  oldIdIndex: ReadonlyMap<NodeId, { from: number; to: number }>,
  after: State,
  topLevelIndex: number,
): boolean {
  // Source range to replace = original range of the OLD tree's top-level
  // form at `topLevelIndex`. We look it up via the previous idIndex.
  const oldRoot = view.state.field(structField).state.tree.root;
  const oldChild = oldRoot.children[topLevelIndex];
  if (!oldChild) {
    return dispatchWholeDocReplace(view, after);
  }
  const oldRange = oldIdIndex.get(oldChild.id);
  if (!oldRange) {
    return dispatchWholeDocReplace(view, after);
  }
  const newRoot = after.tree.root;
  const newChild = newRoot.children[topLevelIndex];
  if (!newChild) {
    // The mutation removed this top-level form. Whole-doc re-render covers
    // this rare case.
    return dispatchWholeDocReplace(view, after);
  }
  const text = printNode(newChild);
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
  const cursors = redoCursorsFromPaths(intendedPaths, tree);
  view.dispatch({
    effects: setStructState.of({
      state: { tree, cursors },
      idIndex,
      cursorPaths: pathsFromCursorSet(cursors, tree),
    }),
  });
}

function redoCursorsFromPaths(
  paths: ReadonlyArray<ReadonlyArray<number>>,
  tree: Tree,
) {
  type CoreNode = import("../core/index.ts").Node;
  // Rebuild a CursorSet at those paths against the new tree.
  const out = paths.map((p) => {
    let cur: CoreNode = tree.root;
    for (const i of p) {
      if (
        cur.kind === "list" || cur.kind === "vector" ||
        cur.kind === "map" || cur.kind === "set" || cur.kind === "document"
      ) {
        const next: CoreNode | undefined = cur.children[i];
        if (!next) {
          cur = tree.root;
          break;
        }
        cur = next;
      } else {
        cur = tree.root;
        break;
      }
    }
    return { kind: "node" as const, target: cur.id };
  });
  if (out.length === 0) {
    return { primary: { kind: "node" as const, target: tree.root.id }, secondaries: [] };
  }
  return { primary: out[0], secondaries: out.slice(1) };
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
