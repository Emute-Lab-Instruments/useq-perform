/**
 * Auto-sync the structural cursor to the CodeMirror caret.
 *
 * The new functional core treats the structural cursor as first-class state
 * (spec §1.3 — focus-primary). The legacy node-highlight plugin had no
 * structural cursor; it derived the halo on the fly from the CM caret via
 * `findNodeAt`. To restore the legacy "polygon follows the caret" UX without
 * tearing out the new cursor model, this plugin watches user-driven CM
 * selection changes and re-points the structural cursor at the smallest
 * addressable node enclosing the caret head.
 *
 * Loop avoidance: a transaction carrying a `setStructState` effect was
 * dispatched by structural nav itself (`adapter/applyOp.ts`), so we skip it.
 * That covers the case where `nav.out` lifts the cursor to a parent compound
 * — without the skip, the auto-sync would immediately drag the cursor back
 * down to the smallest enclosing leaf.
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
    constructor(view: EditorView) {
      this.view = view;
    }
    update(u: ViewUpdate): void {
      if (!u.selectionSet) return;
      // Doc edits run cursorPath re-derivation; let that win.
      if (u.docChanged) return;
      // If structural nav drove this transaction, don't fight it.
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(setStructState)) return;
        }
      }
      const value = u.state.field(structField, false);
      if (!value) return;
      const pos = u.state.selection.main.head;
      const enclosingId = findSmallestEnclosingAddressableNode(
        value.state.tree.root,
        value.idIndex,
        pos,
      );
      if (enclosingId === null) return;
      const primary = value.state.cursors.primary;
      if (primary.kind === "node" && primary.target === enclosingId) return;
      // Can't dispatch inside update(); defer to a microtask.
      const view = this.view;
      const idIndex = value.idIndex;
      const tree = value.state.tree;
      queueMicrotask(() => {
        if (this.destroyed) return;
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
