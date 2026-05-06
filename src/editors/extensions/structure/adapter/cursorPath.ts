/**
 * Cursor-stability across re-parses.
 *
 * Round 2 mints fresh ids on every Lezer→core fold. To keep the cursor
 * "where the user left it" between text edits, we serialise each cursor as
 * a structural path (list of child indices from the document root) just
 * before a transaction is dispatched, and resolve it back to a NodeCursor
 * after the new tree is built.
 *
 * Range cursors aren't supported in this round (round-2 scope). If the
 * primary cursor is a range, we collapse to its anchor end before saving
 * the path. Ranges are restored as node cursors on the anchor.
 */

import type {
  Cursor,
  CursorSet,
  DocumentNode,
  Node,
  NodeId,
  Tree,
} from "../core/index.ts";
import { nodeCursor, singleCursor } from "../core/index.ts";
import { pathOf, nodeAtPathClamped } from "../core/traversal.ts";

export type CursorPath = ReadonlyArray<number>;

export function pathOfCursor(c: Cursor, tree: Tree): CursorPath | null {
  const targetId: NodeId =
    c.kind === "node" ? c.target : c.anchor === "start" ? c.start : c.end;
  return pathOf(tree.root, targetId);
}

export function cursorAtPath(
  path: CursorPath,
  tree: Tree,
): Cursor {
  const node = nodeAtPathClamped(tree.root, path);
  if (node.kind === "document") {
    const first = (tree.root as DocumentNode).children[0] as Node | undefined;
    return nodeCursor(first?.id ?? tree.root.id);
  }
  return nodeCursor(node.id);
}

/**
 * Re-derive a CursorSet onto a freshly-parsed tree, using paths captured
 * from the previous tree. Out-of-range indices are clamped to the nearest
 * valid sibling, keeping the cursor in the same neighbourhood.
 */
export function rederiveCursors(
  paths: ReadonlyArray<CursorPath>,
  tree: Tree,
): CursorSet {
  if (paths.length === 0) {
    return singleCursor(nodeCursor(tree.root.id));
  }
  const cursors = paths.map((p) => cursorAtPath(p, tree));
  return { primary: cursors[0], secondaries: cursors.slice(1) };
}

export function pathsFromCursorSet(
  cs: CursorSet,
  tree: Tree,
): ReadonlyArray<CursorPath> {
  const all: Cursor[] = [cs.primary, ...cs.secondaries];
  const paths: CursorPath[] = [];
  for (const c of all) {
    const p = pathOfCursor(c, tree);
    if (p !== null) paths.push(p);
  }
  return paths;
}
