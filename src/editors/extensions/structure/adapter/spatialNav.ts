/**
 * Vertical spatial navigation (`nav.up` / `nav.down`, §5.1.10).
 *
 * Unlike the tree-level nav ops in `core/nav.ts` (which are pure (Tree, CursorSet)
 * → (Tree, CursorSet)) and unlike the Euler-tour `nav.left`/`nav.right` (also
 * pure), vertical spatial nav needs **source positions** — line numbers and
 * columns — which the pure core deliberately does not carry. We therefore
 * implement it in the adapter, against the `idIndex` produced by
 * `treeFromLezer`.
 *
 * Algorithm (per spec §5.1.10):
 *
 *   1. Identify the start line and column of the focused node's source span.
 *   2. Walk lines upward (`up`) or downward (`down`) until we find a
 *      non-empty line. A line counts as "non-empty" when at least one
 *      addressable node from the core tree starts on it. Whitespace-only
 *      and pure-comment lines (which contain no addressable nodes — comments
 *      are stripped by `treeFromLezer`) are skipped.
 *   3. On the target line, enumerate every node id whose source span starts
 *      on that line.
 *      a. Among those whose `[start_col, end_col]` (inclusive, see edge-case
 *         note below) overlaps the original column, pick the one at the
 *         greatest nesting depth (innermost match).
 *      b. If none overlap, pick the first node at the shallowest depth
 *         (i.e. the topmost-enclosing form on that line).
 *   4. Move the cursor to that node. No-op (returns false) if there is no
 *      non-empty line above/below.
 *
 * Edge case — column overlap inclusivity:
 *   We treat both endpoints as inclusive, i.e. `start_col <= column <= end_col`.
 *   A node from offset `from` to `to` exclusive has end_col = `to - lineStart`.
 *   This means a node range `(c)` at columns 0..3 (inclusive end) is
 *   considered to overlap column 3 — a cursor sitting just past the end of
 *   the previous line's deeply-nested node still "lands" on the enclosing
 *   form of the next line. The spec text says "overlap" without further
 *   qualification; we pick the inclusive interpretation because it is more
 *   forgiving and matches typical user expectation for line-aligned forms.
 */

import type { EditorView } from "@codemirror/view";

import {
  isCompound,
  nodeCursor,
  parentOf,
  type DocumentNode,
  type Node,
  type NodeId,
} from "../core/index.ts";
import { pathsFromCursorSet } from "./cursorPath.ts";
import { setStructState, structField } from "./stateField.ts";

/** Move cursor to nearest node on the previous non-empty source line. */
export function navUp(view: EditorView): boolean {
  return navVertical(view, -1);
}

/** Move cursor to nearest node on the next non-empty source line. */
export function navDown(view: EditorView): boolean {
  return navVertical(view, +1);
}

function navVertical(view: EditorView, direction: 1 | -1): boolean {
  const value = view.state.field(structField, false);
  if (!value) return false;

  const { state: coreState, idIndex } = value;
  const tree = coreState.tree;
  const primary = coreState.cursors.primary;
  const focusId =
    primary.kind === "node"
      ? primary.target
      : primary.anchor === "start"
        ? primary.start
        : primary.end;

  const focusRange = idIndex.get(focusId);
  if (!focusRange) return false;

  const doc = view.state.doc;
  const startLine = doc.lineAt(focusRange.from);
  const column = focusRange.from - startLine.from;

  // Build a per-line lookup keyed by line number → ids whose ranges start on
  // that line. Cheap to build for our document sizes.
  const linesByNumber = new Map<number, NodeId[]>();
  for (const [id, range] of idIndex) {
    if (id === tree.root.id) continue; // skip the document root
    const ln = doc.lineAt(range.from).number;
    let arr = linesByNumber.get(ln);
    if (!arr) {
      arr = [];
      linesByNumber.set(ln, arr);
    }
    arr.push(id);
  }

  // Walk lines in `direction` until we find a non-empty line (one with at
  // least one node starting on it).
  const lastLine = doc.lines;
  let targetLineNo = startLine.number + direction;
  let candidates: NodeId[] | undefined;
  while (targetLineNo >= 1 && targetLineNo <= lastLine) {
    const arr = linesByNumber.get(targetLineNo);
    if (arr && arr.length > 0) {
      candidates = arr;
      break;
    }
    targetLineNo += direction;
  }
  if (!candidates) return false; // no non-empty line above/below

  const targetLine = doc.line(targetLineNo);
  const lineStart = targetLine.from;
  const lineEnd = targetLine.to;

  // For each candidate compute its [start_col, end_col] on the target line
  // and its nesting depth in the core tree.
  type Cand = {
    id: NodeId;
    startCol: number;
    endCol: number;
    depth: number;
  };
  const detailed: Cand[] = candidates.map((id) => {
    const range = idIndex.get(id)!;
    const startCol = range.from - lineStart;
    // Clamp end-of-range to the end of the line (a multi-line compound's
    // span extends past the line, but we only care about its presence on
    // this line).
    const endOffset = Math.min(range.to, lineEnd);
    const endCol = endOffset - lineStart;
    const depth = depthOf(tree.root, id);
    return { id, startCol, endCol, depth };
  });

  // Prefer overlap with `column` (inclusive on both ends); among overlapping,
  // pick the deepest. If none overlap, pick the shallowest-and-earliest.
  const overlapping = detailed.filter(
    (c) => c.startCol <= column && column <= c.endCol,
  );

  let chosen: Cand | undefined;
  if (overlapping.length > 0) {
    // Deepest. Tie-break: the one whose start column is closer to `column`
    // (deterministic; matters when two siblings share a depth — rare since
    // siblings can't both contain the same column unless one is empty).
    chosen = overlapping.reduce((best, cur) => {
      if (cur.depth > best.depth) return cur;
      if (cur.depth < best.depth) return best;
      const dCur = Math.abs(cur.startCol - column);
      const dBest = Math.abs(best.startCol - column);
      return dCur < dBest ? cur : best;
    });
  } else {
    // No overlap → shallowest depth, tie-break by leftmost start column.
    chosen = detailed.reduce((best, cur) => {
      if (cur.depth < best.depth) return cur;
      if (cur.depth > best.depth) return best;
      return cur.startCol < best.startCol ? cur : best;
    });
  }

  if (!chosen) return false;

  // Build the new cursor and dispatch.
  const newCursors = {
    primary: nodeCursor(chosen.id),
    secondaries: [],
  };
  const newState = { tree, cursors: newCursors };
  view.dispatch({
    effects: setStructState.of({
      state: newState,
      idIndex,
      cursorPaths: pathsFromCursorSet(newCursors, tree),
    }),
    scrollIntoView: true,
  });

  // Move CodeMirror's selection to the start of the chosen node so the
  // visual feedback follows. Mirrors `applyOp.ts`'s `scrollPrimaryIntoView`.
  const range = idIndex.get(chosen.id);
  if (range) {
    const docLen = view.state.doc.length;
    const anchor = Math.max(0, Math.min(range.from, docLen));
    const sel = view.state.selection.main;
    if (sel.from < range.from || sel.from > range.to) {
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
    }
  }
  return true;
}

/**
 * Compute the depth of `id` in the tree. The document root has depth 0;
 * its direct children have depth 1; grandchildren depth 2; and so on.
 *
 * This is implemented via a single document-order walk (cheap; doc trees are
 * small per the round-2 brief). If profiling later shows it hot, an idIndex
 * built alongside the parse could memoise depths.
 */
function depthOf(root: DocumentNode, id: NodeId): number {
  let found = -1;
  const walk = (n: Node, depth: number): void => {
    if (found !== -1) return;
    if (n.id === id) {
      found = depth;
      return;
    }
    if (isCompound(n) || n.kind === "document") {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  if (found !== -1) return found;
  // Fallback: walk parents — should not be needed if id is in tree.
  let depth = 0;
  let parent = parentOf(root, id);
  while (parent !== null) {
    depth += 1;
    if (parent.kind === "document") break;
    parent = parentOf(root, parent.id);
  }
  return depth;
}

// Re-exported for tests/diagnostics.
export const _internals = { depthOf };
