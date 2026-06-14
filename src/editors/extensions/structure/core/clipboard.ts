/**
 * Structural clipboard / kill-ring operations (spec §8.4).
 *
 * The act-on layer exposes cut / copy / paste / duplicate verbs over the
 * focused node. Unlike the document-root bulk clipboard ops (`doc.cutAll` /
 * `doc.copyAll`, see docOps.ts) these act on a *single* structural node:
 *
 *   cut         — remove the focused node, retaining a structural snapshot.
 *   copy        — retain a structural snapshot; tree unchanged.
 *   paste       — insert a fresh clone of the snapshot as the next sibling.
 *   pasteBefore — insert a fresh clone of the snapshot as the previous sibling.
 *   duplicate   — copy + paste-after in one step.
 *
 * The retained snapshot is a structural Node (subtree), not text — so a paste
 * re-prints through the normal `printNode` path and round-trips metas/holes.
 * Each paste deep-clones the snapshot with FRESH ids so repeated pastes (and
 * duplicate) never alias node identities in the live tree (§2.8).
 *
 * The core is pure: it neither owns nor mutates the kill-ring. The adapter
 * holds the snapshot and threads it in/out (mirroring how docOps leaves the
 * impure clipboard write to the adapter).
 */

import {
  childrenOf,
  findById,
  indexOfChild,
  parentOf,
  replaceChildren,
} from "./traversal.ts";
import type {
  AddressableNode,
  IdGen,
  Node,
  NodeId,
  OpResult,
  State,
} from "./types.ts";
import { makeTree, nodeCursor, singleCursor } from "./types.ts";

/** A retained structural snapshot for the kill-ring. */
export type Clip = AddressableNode;

/**
 * Deep-clone an addressable node, minting a fresh id for it and every
 * descendant. Metas are carried by reference (their payloads are opaque, §6),
 * but the host node gets a new identity so the clone is independent.
 */
export function cloneWithFreshIds(node: AddressableNode, ids: IdGen): AddressableNode {
  switch (node.kind) {
    case "symbol":
      return { id: ids.next(), kind: "symbol", metas: node.metas, text: node.text };
    case "number":
      return { id: ids.next(), kind: "number", metas: node.metas, text: node.text };
    case "keyword":
      return { id: ids.next(), kind: "keyword", metas: node.metas, text: node.text };
    case "string":
      return { id: ids.next(), kind: "string", metas: node.metas, text: node.text };
    case "hole":
      return {
        id: ids.next(),
        kind: "hole",
        metas: node.metas,
        name: node.name,
        holeType: node.holeType,
      };
    case "list":
    case "vector":
    case "map":
    case "set": {
      const children = node.children.map((c) =>
        cloneWithFreshIds(c as AddressableNode, ids),
      );
      return { id: ids.next(), kind: node.kind, metas: node.metas, children } as AddressableNode;
    }
  }
}

/**
 * Snapshot the focused node as a Clip (deep clone with fresh ids). Returns
 * null when the focus is the document root or a range cursor (which the
 * single-node clipboard verbs don't address).
 */
export function snapshotFocused(s: State, ids: IdGen): Clip | null {
  const c = s.cursors.primary;
  if (c.kind !== "node") return null;
  const node = findById(s.tree.root, c.target);
  if (node === null || node.kind === "document") return null;
  return cloneWithFreshIds(node, ids);
}

// ─── cut ────────────────────────────────────────────────────────────────────

/**
 * Remove the focused node. The cursor relocates to the next sibling, else the
 * previous sibling, else the parent — matching `delete` (§5.2.8 / §3.6). The
 * adapter is responsible for retaining the snapshot via `snapshotFocused`.
 */
export function cut(s: State): OpResult {
  const c = s.cursors.primary;
  if (c.kind !== "node") {
    return { state: s, noOps: [{ cursor: c, reason: "on-leaf" }] };
  }
  const N = findById(s.tree.root, c.target);
  if (N === null || N.kind === "document") {
    return { state: s, noOps: [{ cursor: c, reason: "at-document-root" }] };
  }
  const parent = parentOf(s.tree.root, N.id);
  if (parent === null) {
    return { state: s, noOps: [{ cursor: c, reason: "at-document-root" }] };
  }
  const idx = indexOfChild(s.tree.root, N.id);
  const newKids = parent.children.filter((k) => k.id !== N.id);
  const newRoot = replaceChildren(s.tree.root, parent.id, newKids);
  let cursorTarget: NodeId;
  if (newKids.length === 0) {
    cursorTarget = parent.id;
  } else if (idx < newKids.length) {
    cursorTarget = newKids[idx].id;
  } else {
    cursorTarget = newKids[newKids.length - 1].id;
  }
  return {
    state: { tree: makeTree(newRoot), cursors: singleCursor(nodeCursor(cursorTarget)) },
    noOps: [],
  };
}

// ─── paste / pasteBefore ──────────────────────────────────────────────────────

/**
 * Insert a fresh clone of `clip` adjacent to the focused node, as a sibling
 * under the focus's parent. `where` selects which side. The cursor moves to
 * the newly inserted clone.
 *
 * Insertion works at any level, including the document root (top-level paste),
 * so `((a) c)` + paste `b` ⇒ `((a) c) b`.
 */
function pasteAdjacent(
  s: State,
  clip: Clip | null,
  ids: IdGen,
  where: "after" | "before",
): OpResult {
  const c = s.cursors.primary;
  if (clip === null) {
    // Nothing in the kill-ring — paste is a no-op (§8.4).
    return { state: s, noOps: [{ cursor: c, reason: "no-children" }] };
  }
  if (c.kind !== "node") {
    return { state: s, noOps: [{ cursor: c, reason: "on-leaf" }] };
  }
  const N = findById(s.tree.root, c.target);
  if (N === null || N.kind === "document") {
    return { state: s, noOps: [{ cursor: c, reason: "at-document-root" }] };
  }
  const parent = parentOf(s.tree.root, N.id);
  if (parent === null) {
    return { state: s, noOps: [{ cursor: c, reason: "at-document-root" }] };
  }
  const fresh = cloneWithFreshIds(clip, ids);
  const idx = indexOfChild(s.tree.root, N.id);
  const insertAt = where === "after" ? idx + 1 : idx;
  const kids = parent.children.slice() as Node[];
  kids.splice(insertAt, 0, fresh);
  const newRoot = replaceChildren(s.tree.root, parent.id, kids);
  return {
    state: { tree: makeTree(newRoot), cursors: singleCursor(nodeCursor(fresh.id)) },
    noOps: [],
  };
}

/** Paste a clone of `clip` after the focused node. */
export function paste(s: State, clip: Clip | null, ids: IdGen): OpResult {
  return pasteAdjacent(s, clip, ids, "after");
}

/** Paste a clone of `clip` before the focused node. */
export function pasteBefore(s: State, clip: Clip | null, ids: IdGen): OpResult {
  return pasteAdjacent(s, clip, ids, "before");
}

// ─── duplicate ────────────────────────────────────────────────────────────────

/**
 * Duplicate the focused node: insert a fresh clone of it immediately after,
 * leaving the cursor on the new copy. Equivalent to copy + paste-after but
 * self-contained (no kill-ring mutation).
 */
export function duplicate(s: State, ids: IdGen): OpResult {
  const c = s.cursors.primary;
  if (c.kind !== "node") {
    return { state: s, noOps: [{ cursor: c, reason: "on-leaf" }] };
  }
  const N = findById(s.tree.root, c.target);
  if (N === null || N.kind === "document") {
    return { state: s, noOps: [{ cursor: c, reason: "at-document-root" }] };
  }
  const clip = cloneWithFreshIds(N as AddressableNode, ids);
  return pasteAdjacent(s, clip, ids, "after");
}

// Re-export for the (rare) caller that wants raw children access in tests.
export { childrenOf };
