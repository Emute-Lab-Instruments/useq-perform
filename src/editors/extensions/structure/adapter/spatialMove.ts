/**
 * Vertical spatial *move* (`move_up` / `move_down`).
 *
 * These relocate the focused node across source lines, in contrast to
 * `nav.up`/`nav.down` (spatialNav.ts) which only move the cursor. They are the
 * directional-relocation counterpart to the horizontal sibling transposes
 * (`edit.transposeNext`/`edit.transposePrev`, to which `move_right`/`move_left`
 * are aliased in the dispatcher).
 *
 * Semantics (grounded in test/new_structural/spatial_move_tests.yaml — these
 * ops are not yet covered by docs/specs/structural-editing.md, so the YAML's
 * concrete expected outputs are the contract):
 *
 *   move_down: detach the focused node from its current parent and insert it as
 *     the FIRST child of the nearest enclosing compound on the next non-empty
 *     source line.
 *       (a b)\n(c d)  focus a  →  (b)\n(a c d)   focus a
 *
 *   move_up: detach the focused node and insert it as the LAST child of the
 *     nearest enclosing compound on the previous non-empty source line.
 *       (a b)\n(c d)  focus c  →  (a b c)\n(d)   focus c
 *
 * Like spatialNav, this needs source positions (line numbers) that the pure
 * core does not carry, so it lives in the adapter and works against the
 * `idIndex` produced by `treeFromLezer`.
 */

import type { EditorView } from "@codemirror/view";

import {
  findById,
  indexOfChild,
  isCompound,
  makeTree,
  nodeCursor,
  parentOf,
  type DocumentNode,
  type Node,
  type NodeId,
} from "../core/index.ts";
import { replaceChildren } from "../core/traversal.ts";
import { applyOp } from "./applyOp.ts";
import { structField } from "./stateField.ts";

/** Relocate the focused node to the next source line's enclosing compound. */
export function moveDown(view: EditorView): boolean {
  return moveVertical(view, +1);
}

/** Relocate the focused node to the previous source line's enclosing compound. */
export function moveUp(view: EditorView): boolean {
  return moveVertical(view, -1);
}

function moveVertical(view: EditorView, direction: 1 | -1): boolean {
  const value = view.state.field(structField, false);
  if (!value) return false;

  const { state: coreState, idIndex } = value;
  const tree = coreState.tree;
  const root = tree.root;
  const primary = coreState.cursors.primary;

  // Only node cursors relocate; a range move is out of scope for these rows.
  if (primary.kind !== "node") return false;
  const focusId = primary.target;

  const focusNode = findById(root, focusId);
  if (focusNode === null || focusNode.kind === "document") return false;

  const sourceParent = parentOf(root, focusId);
  if (sourceParent === null) return false;

  const focusRange = idIndex.get(focusId);
  if (!focusRange) return false;

  const doc = view.state.doc;
  const startLineNo = doc.lineAt(focusRange.from).number;

  // Build a per-line index of node ids whose source span starts on that line.
  const linesByNumber = new Map<number, NodeId[]>();
  for (const [id, range] of idIndex) {
    if (id === root.id) continue;
    const ln = doc.lineAt(range.from).number;
    let arr = linesByNumber.get(ln);
    if (!arr) {
      arr = [];
      linesByNumber.set(ln, arr);
    }
    arr.push(id);
  }

  // Walk to the nearest non-empty line in `direction`.
  const lastLine = doc.lines;
  let targetLineNo = startLineNo + direction;
  let candidates: NodeId[] | undefined;
  while (targetLineNo >= 1 && targetLineNo <= lastLine) {
    const arr = linesByNumber.get(targetLineNo);
    if (arr && arr.length > 0) {
      candidates = arr;
      break;
    }
    targetLineNo += direction;
  }
  if (!candidates) return false; // no source line above/below

  // The destination is the shallowest (topmost-enclosing) compound that starts
  // on the target line — the form the user visually sees on that line.
  const targetCompoundId = shallowestCompoundOnLine(root, idIndex, candidates);
  if (targetCompoundId === null) return false;

  // Never relocate a node into itself or one of its own descendants.
  if (
    targetCompoundId === focusId ||
    isDescendant(root, focusId, targetCompoundId)
  ) {
    return false;
  }

  // Apply the relocation as a tree op so it routes through applyOp
  // (history, decorations, cursor remap) like every other structural edit.
  // The op returns a proper OpResult — `state` carries the new tree and the
  // relocated cursor (primary on the moved node), `noOps` is empty on success.
  return applyOp(view, (s) => {
    const r = s.tree.root;
    const N = findById(r, focusId);
    const parent = parentOf(r, focusId);
    const target = findById(r, targetCompoundId);
    const fail = (reason: import("../core/index.ts").NoOpReason) => ({
      state: s,
      noOps: [{ cursor: s.cursors.primary, reason }],
    });
    if (N === null || parent === null || target === null || !isCompound(target)) {
      return fail("at-document-root");
    }

    // 1. Remove N from its current parent.
    const idx = indexOfChild(r, focusId);
    if (idx < 0) return fail("at-document-root");
    const newSiblings = parent.children.slice() as Node[];
    newSiblings.splice(idx, 1);
    let newRoot: DocumentNode = replaceChildren(r, parent.id, newSiblings);

    // 2. Insert N into the target compound — first child going down, last child
    //    going up (mirrors the visual "drop onto the line" direction).
    const liveTarget = findById(newRoot, targetCompoundId);
    if (liveTarget === null || !isCompound(liveTarget)) {
      return fail("at-document-root");
    }
    const targetKids = liveTarget.children.slice() as Node[];
    if (direction > 0) {
      targetKids.unshift(N);
    } else {
      targetKids.push(N);
    }
    newRoot = replaceChildren(newRoot, targetCompoundId, targetKids);

    return {
      state: {
        tree: makeTree(newRoot),
        cursors: { primary: nodeCursor(focusId), secondaries: [] },
      },
      noOps: [],
    };
  });
}

/**
 * Among node ids that start on a given line, return the id of the shallowest
 * compound (smallest depth). Ties break on leftmost start. Returns null if no
 * candidate is a compound.
 */
function shallowestCompoundOnLine(
  root: DocumentNode,
  idIndex: ReadonlyMap<NodeId, { from: number; to: number }>,
  ids: ReadonlyArray<NodeId>,
): NodeId | null {
  let bestId: NodeId | null = null;
  let bestDepth = Infinity;
  let bestFrom = Infinity;
  for (const id of ids) {
    const node = findById(root, id);
    if (node === null || !isCompound(node)) continue;
    const depth = depthOf(root, id);
    const from = idIndex.get(id)?.from ?? Infinity;
    if (depth < bestDepth || (depth === bestDepth && from < bestFrom)) {
      bestId = id;
      bestDepth = depth;
      bestFrom = from;
    }
  }
  return bestId;
}

/** Depth in the tree: document root = 0, its children = 1, … */
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
  return found === -1 ? 0 : found;
}

/** True when `candidateId` is a (strict) descendant of `ancestorId`. */
function isDescendant(
  root: DocumentNode,
  ancestorId: NodeId,
  candidateId: NodeId,
): boolean {
  let parent = parentOf(root, candidateId);
  while (parent !== null) {
    if (parent.id === ancestorId) return true;
    if (parent.kind === "document") break;
    parent = parentOf(root, parent.id);
  }
  return false;
}
