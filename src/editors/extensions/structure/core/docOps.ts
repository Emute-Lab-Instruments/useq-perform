/**
 * Document-root bulk operations (spec §5.3).
 *
 * These ops act on the document as a whole, ignoring the current cursor set.
 * They do NOT use the pointwise lift — they always target the root.
 *
 *   doc.deleteAll — clear all children; cursor on empty root
 *   doc.selectAll — cursor on root (tree unchanged)
 *
 * doc.cutAll and doc.copyAll share the same tree semantics (deleteAll / no-op
 * respectively) but require an impure clipboard side-effect. The adapter layer
 * handles the clipboard; the core exposes only the pure tree+cursor result.
 */

import type { DocumentNode, OpResult, State } from "./types.ts";
import { makeTree, nodeCursor, singleCursor } from "./types.ts";

// ─── doc.deleteAll ────────────────────────────────────────────────────────────

/**
 * Delete all top-level forms. The resulting tree has an empty document root
 * and the cursor sits on it.
 */
export function docDeleteAll(s: State): OpResult {
  const root = s.tree.root;
  if (root.children.length === 0) {
    // Already empty — no-op but not an error; cursor just stays on root.
    return {
      state: { tree: s.tree, cursors: singleCursor(nodeCursor(root.id)) },
      noOps: [],
    };
  }
  const newRoot: DocumentNode = { id: root.id, kind: "document", children: [] };
  return {
    state: { tree: makeTree(newRoot), cursors: singleCursor(nodeCursor(newRoot.id)) },
    noOps: [],
  };
}

// ─── doc.selectAll ────────────────────────────────────────────────────────────

/**
 * Select all: place a single cursor on the document root. Tree unchanged.
 */
export function docSelectAll(s: State): OpResult {
  return {
    state: { tree: s.tree, cursors: singleCursor(nodeCursor(s.tree.root.id)) },
    noOps: [],
  };
}
