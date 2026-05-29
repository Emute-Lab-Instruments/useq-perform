/**
 * Navigation operations (§5.1).
 *
 * Tree unchanged; cursor set updated. All ops apply pointwise to every
 * cursor in the set. When a cursor cannot move, it is left unchanged and a
 * `noOps` entry is emitted with a `NoOpReason`. The state object's tree is
 * always identical (===) to the input on every nav op.
 *
 * Naming follows the spec exactly:
 *   - `nav.out` (§5.1.1) — to parent
 *   - `nav.in`  (§5.1.2) — to first child
 *   - `nav.up` / `nav.down`   (§5.1.10) — vertical spatial (line-based; lives
 *     in the adapter, not here, since it needs source positions)
 *   - `nav.left` / `nav.right` (§5.1.9)  — horizontal Euler-tour spatial
 *     (pure; implemented here). Each compound is visited twice — once
 *     before its children (pre-order) and once after (post-order). The
 *     traversal phase is carried on the cursor as `NodeCursor.phase`. All
 *     non-spatial nav ops emit cursors without `phase`, which the spatial
 *     ops interpret as pre-order — that gives the spec's "phase resets
 *     when arriving via a non-spatial op" behaviour for free.
 *
 * §5.1.9 (`nav.intoMeta`) is intentionally unimplemented: the core tree model
 * stores a Meta's `payload` as opaque `unknown` (see `types.ts`), so there is
 * no addressable payload node for a cursor to descend into yet. Implementing
 * it requires `treeFromLezer` to lower Meta payloads into real, id-bearing
 * nodes (tracked alongside the wrapper-recognition work). Until then the op
 * is absent from `nav` rather than a no-op stub.
 */

import { findHolesInOrder } from "./holes.ts";
import {
  childrenOf,
  findById,
  indexOfChild,
  parentOf,
} from "./traversal.ts";
import type {
  Cursor,
  CursorSet,
  NoOpReason,
  NodeCursor,
  NodeId,
  OpResult,
  RangeCursor,
  State,
  Tree,
} from "./types.ts";
import { cursorList, nodeCursor, rangeCursor } from "./types.ts";

// ─── Pointwise lift ────────────────────────────────────────────────────────

type CursorOp = (
  c: Cursor,
  tree: Tree,
) => { cursor: Cursor } | { reason: NoOpReason };

function applyPointwise(state: State, op: CursorOp): OpResult {
  const noOps: Array<{ cursor: Cursor; reason: NoOpReason }> = [];
  const moved: Cursor[] = [];
  for (const c of cursorList(state.cursors)) {
    const r = op(c, state.tree);
    if ("reason" in r) {
      noOps.push({ cursor: c, reason: r.reason });
      moved.push(c); // unchanged
    } else {
      moved.push(r.cursor);
    }
  }
  const cursors: CursorSet = { primary: moved[0], secondaries: moved.slice(1) };
  return { state: { tree: state.tree, cursors }, noOps };
}

// ─── Single-cursor primitives ──────────────────────────────────────────────

function navOutOne(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  const targetId = focusedId(c);
  const parent = parentOf(tree.root, targetId);
  if (parent === null) {
    // Either at document root, or cursor target isn't in tree (shouldn't
    // happen in practice; treat as no-op).
    return { reason: "at-document-root" };
  }
  if (parent.kind === "document") {
    // We're at a top-level form; nav.out reaches the document root.
    return { cursor: nodeCursor(parent.id) };
  }
  return { cursor: nodeCursor(parent.id) };
}

function navInOne(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  const target = focusedNode(c, tree);
  if (target === null) return { reason: "at-document-root" };
  const kids = childrenOf(target);
  if (kids.length === 0) {
    // Either a leaf or an empty compound.
    if (
      target.kind === "list" ||
      target.kind === "vector" ||
      target.kind === "map" ||
      target.kind === "set" ||
      target.kind === "document"
    ) {
      return { reason: "empty-compound" };
    }
    return { reason: "on-leaf" };
  }
  return { cursor: nodeCursor(kids[0].id) };
}

function siblingShift(
  c: Cursor,
  tree: Tree,
  delta: 1 | -1,
): ReturnType<CursorOp> {
  // Pick which end of the cursor we're stepping from. For a range cursor,
  // §5.1.3 isn't fully explicit; the most consistent reading is that a range
  // collapses to a node cursor first by shifting from the side opposite the
  // anchor (i.e. the end the user most recently grew). We instead collapse
  // to the anchor and step from there — predictable and matches how paredit-
  // style tools usually behave.
  const fromId = c.kind === "range"
    ? (c.anchor === "start" ? c.start : c.end)
    : c.target;
  const parent = parentOf(tree.root, fromId);
  if (parent === null) return { reason: "at-document-root" };
  const kids = parent.children;
  const idx = kids.findIndex((k) => k.id === fromId);
  const next = idx + delta;
  if (next < 0) return { reason: "no-prev-sibling" };
  if (next >= kids.length) return { reason: "no-next-sibling" };
  return { cursor: nodeCursor(kids[next].id) };
}

function navFirst(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  const id = focusedId(c);
  const parent = parentOf(tree.root, id);
  if (parent === null) return { reason: "at-document-root" };
  return { cursor: nodeCursor(parent.children[0].id) };
}

function navLast(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  const id = focusedId(c);
  const parent = parentOf(tree.root, id);
  if (parent === null) return { reason: "at-document-root" };
  return {
    cursor: nodeCursor(parent.children[parent.children.length - 1].id),
  };
}

function navExtend(
  c: Cursor,
  tree: Tree,
  direction: "next" | "prev",
): ReturnType<CursorOp> {
  // Extending grows the range outward by one sibling on the requested side.
  // Operates on whichever end is opposite the anchor for a range, or grows
  // outward from a single node.
  if (c.kind === "node") {
    const parent = parentOf(tree.root, c.target);
    if (parent === null) return { reason: "at-document-root" };
    const kids = parent.children;
    const idx = kids.findIndex((k) => k.id === c.target);
    if (direction === "next") {
      if (idx + 1 >= kids.length) return { reason: "range-cannot-extend" };
      return {
        cursor: rangeCursor(parent.id, c.target, kids[idx + 1].id, "start"),
      };
    } else {
      if (idx - 1 < 0) return { reason: "range-cannot-extend" };
      return {
        cursor: rangeCursor(parent.id, kids[idx - 1].id, c.target, "end"),
      };
    }
  }
  // Range: grow outward on the non-anchor side.
  const parent = findById(tree.root, c.parent);
  if (parent === null || parent.kind === "document") {
    // parent must be a compound for ranges to exist.
    return { reason: "at-document-root" };
  }
  if (parent.kind !== "list" && parent.kind !== "vector" &&
      parent.kind !== "map" && parent.kind !== "set") {
    return { reason: "at-document-root" };
  }
  const kids = parent.children;
  if (direction === "next") {
    const endIdx = kids.findIndex((k) => k.id === c.end);
    if (endIdx + 1 >= kids.length) {
      return { reason: "range-cannot-extend" };
    }
    return {
      cursor: rangeCursor(c.parent, c.start, kids[endIdx + 1].id, c.anchor),
    };
  } else {
    const startIdx = kids.findIndex((k) => k.id === c.start);
    if (startIdx - 1 < 0) return { reason: "range-cannot-extend" };
    return {
      cursor: rangeCursor(c.parent, kids[startIdx - 1].id, c.end, c.anchor),
    };
  }
}

function navShrink(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  if (c.kind === "node") return { reason: "range-not-shrinkable" };
  // Release the most-recently-added end (the side opposite the anchor).
  const parent = findById(tree.root, c.parent);
  if (parent === null) return { reason: "at-document-root" };
  if (parent.kind !== "list" && parent.kind !== "vector" &&
      parent.kind !== "map" && parent.kind !== "set") {
    return { reason: "at-document-root" };
  }
  const kids = parent.children;
  const startIdx = kids.findIndex((k) => k.id === c.start);
  const endIdx = kids.findIndex((k) => k.id === c.end);
  if (startIdx < 0 || endIdx < 0) return { reason: "at-document-root" };
  // Determine the new range endpoints after shrinking.
  let newStart = c.start;
  let newEnd = c.end;
  if (c.anchor === "start") {
    // Grew rightwards; release rightmost.
    newEnd = kids[endIdx - 1].id;
  } else {
    // Grew leftwards; release leftmost.
    newStart = kids[startIdx + 1].id;
  }
  if (newStart === newEnd) {
    return { cursor: nodeCursor(newStart) };
  }
  return {
    cursor: rangeCursor(c.parent, newStart, newEnd, c.anchor),
  };
}

// ─── Spatial Euler-tour navigation (§5.1.9) ────────────────────────────────
//
// The Euler tour visits each compound twice (pre/post) and each leaf once.
// `nav.right` advances the tour; `nav.left` retreats it. The cursor's
// per-compound phase travels on `NodeCursor.phase` (undefined ≡ "pre").
//
// Range cursors don't carry a phase. We treat them like a node cursor on the
// anchor end (pre-order) — same convention as `siblingShift`.

function isCompoundOrDocKind(k: import("./types.ts").NodeKind): boolean {
  return (
    k === "list" ||
    k === "vector" ||
    k === "map" ||
    k === "set" ||
    k === "document"
  );
}

function navRightOne(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  const focusId = focusedId(c);
  const node = findById(tree.root, focusId);
  if (node === null) return { reason: "at-document-root" };

  const phase: "pre" | "post" =
    c.kind === "node" && c.phase === "post" ? "post" : "pre";

  // Case A: compound (or document) in pre-order → first child (enter).
  if (isCompoundOrDocKind(node.kind) && phase === "pre") {
    const kids = childrenOf(node);
    if (kids.length === 0) {
      // Empty compound: pre-order visit is immediately followed by post-order
      // visit on the same node. Keep the post-phase exit logic uniform with
      // "last child → parent in post-order" by re-emitting the same compound
      // in post-order and recursing once.
      // For the document root with no children, that becomes the
      // traversal-complete no-op below.
      if (node.kind === "document") {
        return { reason: "at-document-root" };
      }
      // Treat as if we just exited the compound's children.
      return { cursor: nodeCursor(node.id, "post") };
    }
    return { cursor: nodeCursor(kids[0].id) };
  }

  // Case B: leaf, OR compound in post-order. Either way, we're "done" with
  // this subtree and need to step sideways or upward.
  // Document root in post-order = traversal complete.
  if (node.kind === "document") {
    return { reason: "at-document-root" };
  }

  const parent = parentOf(tree.root, focusId);
  if (parent === null) {
    // Shouldn't happen — non-document nodes always have a parent — but guard.
    return { reason: "at-document-root" };
  }
  const kids = parent.children;
  const idx = kids.findIndex((k) => k.id === focusId);
  if (idx + 1 < kids.length) {
    // Has a next sibling → step into it in pre-order.
    return { cursor: nodeCursor(kids[idx + 1].id) };
  }
  // Last child → parent in post-order. (For the document root, the cursor
  // lands on it — we'll detect "traversal complete" on the next nav.right
  // via the document-root branch above.)
  return { cursor: nodeCursor(parent.id, "post") };
}

function navLeftOne(c: Cursor, tree: Tree): ReturnType<CursorOp> {
  // Mirror of navRightOne. The two phases swap roles:
  //   - Compound in post-order → last child (enter from the right).
  //   - Leaf / compound in pre-order → previous sibling (in post-order if
  //     compound), or parent in pre-order if first child.
  const focusId = focusedId(c);
  const node = findById(tree.root, focusId);
  if (node === null) return { reason: "at-document-root" };

  const phase: "pre" | "post" =
    c.kind === "node" && c.phase === "post" ? "post" : "pre";

  // Case A: compound (or document) in post-order → last child (enter).
  if (isCompoundOrDocKind(node.kind) && phase === "post") {
    const kids = childrenOf(node);
    if (kids.length === 0) {
      // Empty compound, post→pre (no children to descend into).
      if (node.kind === "document") {
        return { reason: "at-document-root" };
      }
      return { cursor: nodeCursor(node.id) }; // pre-order
    }
    const last = kids[kids.length - 1];
    // Entering a compound child from the right means we visit it in post-order
    // first; leaves are visited just once.
    if (isCompoundOrDocKind(last.kind)) {
      return { cursor: nodeCursor(last.id, "post") };
    }
    return { cursor: nodeCursor(last.id) };
  }

  // Case B: pre-order on a compound, or any leaf. Step sideways/upward.
  // Document root in pre-order = traversal complete (start of document).
  if (node.kind === "document") {
    return { reason: "at-document-root" };
  }

  const parent = parentOf(tree.root, focusId);
  if (parent === null) {
    return { reason: "at-document-root" };
  }
  const kids = parent.children;
  const idx = kids.findIndex((k) => k.id === focusId);
  if (idx > 0) {
    // Previous sibling: if it's a compound, enter from the right (post-order);
    // if it's a leaf, just land on it.
    const prev = kids[idx - 1];
    if (isCompoundOrDocKind(prev.kind)) {
      return { cursor: nodeCursor(prev.id, "post") };
    }
    return { cursor: nodeCursor(prev.id) };
  }
  // First child → parent in pre-order.
  return { cursor: nodeCursor(parent.id) };
}

function navHoleStep(
  c: Cursor,
  tree: Tree,
  direction: "next" | "prev",
): ReturnType<CursorOp> {
  const holes = findHolesInOrder(tree.root);
  if (holes.length === 0) return { reason: "no-hole" };
  const fromId = focusedId(c);
  // Find the strict-next or strict-prev hole id by document-order index of
  // the cursor target. If the target is itself a hole, we step over it.
  const docOrderIds = collectIdsInDocOrder(tree.root);
  const fromIdx = docOrderIds.indexOf(fromId);
  if (direction === "next") {
    for (let i = fromIdx + 1; i < docOrderIds.length; i++) {
      const id = docOrderIds[i];
      if (holes.some((h) => h.id === id)) {
        return { cursor: nodeCursor(id) };
      }
    }
    return { reason: "no-hole" };
  } else {
    for (let i = fromIdx - 1; i >= 0; i--) {
      const id = docOrderIds[i];
      if (holes.some((h) => h.id === id)) {
        return { cursor: nodeCursor(id) };
      }
    }
    return { reason: "no-hole" };
  }
}

// ─── Public ops ────────────────────────────────────────────────────────────

export const nav = {
  /** §5.1.1 — to parent. */
  out: (s: State): OpResult => applyPointwise(s, navOutOne),
  /** §5.1.2 — to first child. */
  in: (s: State): OpResult => applyPointwise(s, navInOne),
  next: (s: State): OpResult =>
    applyPointwise(s, (c, t) => siblingShift(c, t, 1)),
  prev: (s: State): OpResult =>
    applyPointwise(s, (c, t) => siblingShift(c, t, -1)),
  first: (s: State): OpResult => applyPointwise(s, navFirst),
  last: (s: State): OpResult => applyPointwise(s, navLast),
  extendNext: (s: State): OpResult =>
    applyPointwise(s, (c, t) => navExtend(c, t, "next")),
  extendPrev: (s: State): OpResult =>
    applyPointwise(s, (c, t) => navExtend(c, t, "prev")),
  shrink: (s: State): OpResult => applyPointwise(s, navShrink),
  nextHole: (s: State): OpResult =>
    applyPointwise(s, (c, t) => navHoleStep(c, t, "next")),
  prevHole: (s: State): OpResult =>
    applyPointwise(s, (c, t) => navHoleStep(c, t, "prev")),
  /** §5.1.9 — horizontal Euler-tour traversal (forward). */
  right: (s: State): OpResult => applyPointwise(s, navRightOne),
  /** §5.1.9 — horizontal Euler-tour traversal (backward). */
  left: (s: State): OpResult => applyPointwise(s, navLeftOne),
};

// ─── Helpers (also used by mutate.ts) ──────────────────────────────────────

/** Id the cursor "focuses on" for navigation purposes (range → anchor end). */
export function focusedId(c: Cursor): NodeId {
  return c.kind === "node"
    ? c.target
    : (c.anchor === "start" ? c.start : c.end);
}

/** Resolve the cursor's focused node, or null if invalid. */
export function focusedNode(c: Cursor, tree: Tree) {
  return findById(tree.root, focusedId(c));
}

/**
 * All ids in the tree in document order — used by hole stepping. Includes
 * compounds and leaves but excludes the document root itself.
 */
function collectIdsInDocOrder(root: import("./types.ts").DocumentNode): NodeId[] {
  const out: NodeId[] = [];
  const walk = (n: import("./types.ts").Node): void => {
    if (n.kind !== "document") out.push(n.id);
    if (
      n.kind === "list" ||
      n.kind === "vector" ||
      n.kind === "map" ||
      n.kind === "set" ||
      n.kind === "document"
    ) {
      for (const c of n.children) walk(c);
    }
  };
  walk(root);
  return out;
}

/** Convenience for tests: read the index of a node cursor's target. */
export function _focusedIndex(c: NodeCursor, tree: Tree): number {
  return indexOfChild(tree.root, c.target);
}

/** Convenience for tests: parent id of a cursor's focus. */
export function _parentId(c: Cursor, tree: Tree): NodeId | null {
  if (c.kind === "range") return c.parent;
  const p = parentOf(tree.root, c.target);
  return p === null ? null : p.id;
}

/** Re-exported for downstream modules. */
export { nodeCursor, rangeCursor };

// Keep RangeCursor symbol referenced by exports below to avoid unused-type warnings.
export type { RangeCursor };
