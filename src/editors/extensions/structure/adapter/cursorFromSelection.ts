/**
 * Auto-sync the structural cursor to the CodeMirror caret.
 *
 * Watches both selection-only changes and doc-change transactions (typing,
 * backspace, undo, etc.) and re-points the structural cursor at the smallest
 * addressable node enclosing the caret head. This keeps the halo tracking
 * what the user is actively editing.
 *
 * When the caret is not inside any node's source range (whitespace between
 * top-level forms), the cursor resets to the document root, which clears
 * the halo overlay (resolveCursorTargets skips the doc root).
 *
 * Loop avoidance:
 *   - Transactions carrying a `setStructState` effect (structural nav or
 *     setCursorFromState) are skipped — they already set the correct cursor.
 *   - Transactions with userEvent `structure.mutate` or `format.*` are
 *     skipped — they trigger a follow-up setCursorFromState dispatch.
 *   - A sequence counter ensures stale microtasks (queued before a newer
 *     update arrived) are discarded.
 */

import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import {
  childrenOf,
  nodeCursor,
  singleCursor,
  type DocumentNode,
  type Node,
  type NodeId,
  type State,
} from "../core/index.ts";
import { pathsFromCursorSet } from "./cursorPath.ts";
import { setStructState, structField } from "./stateField.ts";
import type { IdIndex } from "./treeFromLezer.ts";

/**
 * Find the deepest non-document node whose inclusive source range
 * contains `pos`.  Ranges are [from, to] (inclusive both ends).
 * Returns null when `pos` falls in the gap between nodes → halo clears.
 */
function findSmallestEnclosingAddressableNode(
  root: DocumentNode,
  idIndex: IdIndex,
  pos: number,
): NodeId | null {
  let best: NodeId | null = null;
  const visit = (node: Node): void => {
    const range = idIndex.get(node.id);
    if (!range) return;
    if (range.from > pos || range.to < pos) return;
    if (node.kind !== "document") best = node.id;
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return best;
}

export const structuralCursorFromSelection = ViewPlugin.fromClass(
  class {
    private view: EditorView;
    private destroyed = false;
    private syncSeq = 0;
    constructor(view: EditorView) {
      this.view = view;
    }
    update(u: ViewUpdate): void {
      if (!u.selectionSet && !u.docChanged) return;
      // If structural nav/mutation drove this transaction, don't fight it.
      // Structural mutations dispatch a follow-up setCursorFromState that
      // sets the correct cursor — interfering here would race with it.
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(setStructState)) return;
        }
        if (tr.isUserEvent("structure.mutate")) return;
        if (tr.isUserEvent("format.")) return;
      }
      const value = u.state.field(structField, false);
      if (!value) return;
      const pos = u.state.selection.main.head;
      const enclosingId = findSmallestEnclosingAddressableNode(
        value.state.tree.root,
        value.idIndex,
        pos,
      );

      // No node encloses the caret → clear the halo by setting cursor to
      // the doc root. resolveCursorTargets() already skips the doc root,
      // so the polygon overlay disappears.
      if (enclosingId === null) {
        const primary = value.state.cursors.primary;
        if (primary.kind === "node" && primary.target === value.state.tree.root.id) return;
        const cs = singleCursor(nodeCursor(value.state.tree.root.id));
        const newState: State = { tree: value.state.tree, cursors: cs };
        const view = this.view;
        const idIndex = value.idIndex;
        const seq = ++this.syncSeq;
        queueMicrotask(() => {
          if (this.destroyed || this.syncSeq !== seq) return;
          view.dispatch({
            effects: setStructState.of({
              state: newState,
              idIndex,
              cursorPaths: pathsFromCursorSet(cs, newState.tree),
            }),
          });
        });
        return;
      }

      const primary = value.state.cursors.primary;
      if (primary.kind === "node" && primary.target === enclosingId) return;
      // Can't dispatch inside update(); defer to a microtask.
      const view = this.view;
      const idIndex = value.idIndex;
      const tree = value.state.tree;
      const seq = ++this.syncSeq;
      queueMicrotask(() => {
        if (this.destroyed || this.syncSeq !== seq) return;
        const cs = singleCursor(nodeCursor(enclosingId));
        const newState: State = { tree, cursors: cs };
        view.dispatch({
          effects: setStructState.of({
            state: newState,
            idIndex,
            cursorPaths: pathsFromCursorSet(cs, tree),
          }),
        });
      });
    }
    destroy(): void {
      this.destroyed = true;
    }
  },
);

export const _internals = { findSmallestEnclosingAddressableNode };
