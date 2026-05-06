/**
 * Tree traversal helpers (id-based).
 *
 * The functional core uses node ids as cursor handles (§2.8). All lookups
 * traverse the tree; document trees are small enough that this is fine for a
 * probe. If profiling later shows hot lookups, adding an id→path index is a
 * local change.
 *
 * Nothing here mutates: every function returns either info about the existing
 * tree or a new tree built by structural sharing.
 */

import type {
  AddressableNode,
  Compound,
  CompoundKind,
  DocumentNode,
  IdGen,
  Meta,
  Node,
  NodeId,
} from "./types.ts";

// ─── Predicates ────────────────────────────────────────────────────────────

export function isCompound(n: Node): n is Compound {
  return (
    n.kind === "list" ||
    n.kind === "vector" ||
    n.kind === "map" ||
    n.kind === "set"
  );
}

export function isCompoundOrDocument(
  n: Node,
): n is Compound | DocumentNode {
  return isCompound(n) || n.kind === "document";
}

export function isLeaf(n: Node): boolean {
  return (
    n.kind === "symbol" ||
    n.kind === "number" ||
    n.kind === "keyword" ||
    n.kind === "string" ||
    n.kind === "hole"
  );
}

export function childrenOf(n: Node): ReadonlyArray<Node> {
  if (isCompound(n) || n.kind === "document") return n.children;
  return [];
}

// ─── Lookup ────────────────────────────────────────────────────────────────

/** A path from root to a node: a list of child indices. Empty path = root. */
export type Path = ReadonlyArray<number>;

/**
 * Find the path (chain of child indices) to the node with the given id, or
 * null if absent. Searching from the document root.
 */
export function pathOf(root: DocumentNode, id: NodeId): Path | null {
  if (root.id === id) return [];
  const stack: Array<{ node: Node; path: number[] }> = [
    { node: root, path: [] },
  ];
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    const kids = childrenOf(node);
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (child.id === id) return [...path, i];
      stack.push({ node: child, path: [...path, i] });
    }
  }
  return null;
}

/** Resolve a path to the node it points at. Returns null if invalid. */
export function nodeAtPath(root: DocumentNode, path: Path): Node | null {
  let cur: Node = root;
  for (const i of path) {
    const kids = childrenOf(cur);
    if (i < 0 || i >= kids.length) return null;
    cur = kids[i];
  }
  return cur;
}

/**
 * Like nodeAtPath but clamps each index to the valid child range instead of
 * returning null. If a container has no children, returns whatever we've
 * reached so far. This keeps the cursor in the neighbourhood of the
 * invalidated path (e.g. after a text edit shrinks a list).
 */
export function nodeAtPathClamped(root: DocumentNode, path: Path): Node {
  let cur: Node = root;
  for (const i of path) {
    const kids = childrenOf(cur);
    if (kids.length === 0) break;
    cur = kids[Math.max(0, Math.min(i, kids.length - 1))];
  }
  return cur;
}

/** Find a node by id, or null. */
export function findById(root: DocumentNode, id: NodeId): Node | null {
  if (root.id === id) return root;
  const p = pathOf(root, id);
  if (p === null) return null;
  return nodeAtPath(root, p);
}

/** True if a node with the given id exists in the tree. */
export function existsInTree(root: DocumentNode, id: NodeId): boolean {
  return findById(root, id) !== null;
}

/** Parent of `id`, or null if `id` is the root or not in the tree. */
export function parentOf(
  root: DocumentNode,
  id: NodeId,
): Compound | DocumentNode | null {
  if (root.id === id) return null;
  const p = pathOf(root, id);
  if (p === null) return null;
  if (p.length === 0) return null;
  const parentPath = p.slice(0, p.length - 1);
  const parent = nodeAtPath(root, parentPath);
  if (parent === null) return null;
  if (!isCompoundOrDocument(parent)) return null; // unreachable but safe
  return parent;
}

/** Index of `id` within its parent's children, or -1 if root/missing. */
export function indexOfChild(root: DocumentNode, id: NodeId): number {
  const p = pathOf(root, id);
  if (p === null || p.length === 0) return -1;
  return p[p.length - 1];
}

// ─── Replacement (structural sharing) ──────────────────────────────────────

/**
 * Return a new root in which the children of `parentId` have been replaced
 * by `newChildren`. All ancestor nodes are rebuilt with new identities for
 * unchanged ones REUSED — only the spine from root to `parentId` is fresh.
 *
 * Throws if `parentId` not found or doesn't refer to a compound/document.
 */
export function replaceChildren(
  root: DocumentNode,
  parentId: NodeId,
  newChildren: ReadonlyArray<Node>,
): DocumentNode {
  const p = pathOf(root, parentId);
  if (p === null) {
    throw new Error(`replaceChildren: parent ${parentId} not in tree`);
  }
  return rebuildSpine(root, p, (node) => {
    if (!isCompoundOrDocument(node)) {
      throw new Error(
        `replaceChildren: target ${parentId} is not a compound (kind=${node.kind})`,
      );
    }
    return setChildren(node, newChildren);
  });
}

/**
 * Replace the node at `id` with `replacement`. Returns a new root; the node's
 * ancestors are rebuilt; siblings keep their identities.
 *
 * For compounds, the replacement may have a different kind (used by `enclose`
 * variants). The replaced node's metas are NOT carried automatically — meta
 * preservation is the caller's responsibility (most mutations carry metas
 * forward by reusing the host node directly per §6.5).
 */
export function replaceNode(
  root: DocumentNode,
  id: NodeId,
  replacement: AddressableNode,
): DocumentNode {
  if (root.id === id) {
    throw new Error("replaceNode: cannot replace document root");
  }
  const p = pathOf(root, id);
  if (p === null) {
    throw new Error(`replaceNode: node ${id} not in tree`);
  }
  // Rebuild the spine; at the deepest step, swap the child at the final index.
  const parentPath = p.slice(0, p.length - 1);
  const childIdx = p[p.length - 1];
  return rebuildSpine(root, parentPath, (parent) => {
    if (!isCompoundOrDocument(parent)) {
      throw new Error("replaceNode: parent is not a compound");
    }
    const kids = parent.children.slice() as Node[];
    kids[childIdx] = replacement;
    return setChildren(parent, kids);
  });
}

/**
 * Walk down `path` from `root`, then run `transform` on the node at that
 * path; rebuild the spine on the way back up. The replacement returned by
 * `transform` must match the kind of the node it replaces (compound stays
 * compound; document stays document).
 */
function rebuildSpine(
  root: DocumentNode,
  path: Path,
  transform: (n: Node) => Node,
): DocumentNode {
  const walk = (node: Node, depth: number): Node => {
    if (depth === path.length) return transform(node);
    if (!isCompoundOrDocument(node)) {
      throw new Error("rebuildSpine: descended into a leaf");
    }
    const idx = path[depth];
    const newChildren = node.children.slice() as Node[];
    newChildren[idx] = walk(node.children[idx], depth + 1);
    return setChildren(node, newChildren);
  };
  const result = walk(root, 0);
  if (result.kind !== "document") {
    throw new Error("rebuildSpine: result is not a document");
  }
  return result;
}

/**
 * Return a copy of `parent` with its children swapped. Preserves id, kind,
 * and (for non-document compounds) metas.
 */
export function setChildren(
  parent: Compound | DocumentNode,
  children: ReadonlyArray<Node>,
): Compound | DocumentNode {
  if (parent.kind === "document") {
    return { id: parent.id, kind: "document", children };
  }
  // Non-document compound: preserve kind, id, metas.
  switch (parent.kind) {
    case "list":
      return { id: parent.id, kind: "list", metas: parent.metas, children };
    case "vector":
      return { id: parent.id, kind: "vector", metas: parent.metas, children };
    case "map":
      return { id: parent.id, kind: "map", metas: parent.metas, children };
    case "set":
      return { id: parent.id, kind: "set", metas: parent.metas, children };
  }
}

// ─── Compound construction ─────────────────────────────────────────────────

export function makeCompound(
  kind: CompoundKind,
  children: ReadonlyArray<Node>,
  ids: IdGen,
  metas: ReadonlyArray<Meta> = [],
): Compound {
  switch (kind) {
    case "list":
      return { id: ids.next(), kind: "list", metas, children };
    case "vector":
      return { id: ids.next(), kind: "vector", metas, children };
    case "map":
      return { id: ids.next(), kind: "map", metas, children };
    case "set":
      return { id: ids.next(), kind: "set", metas, children };
  }
}

export function makeDocument(
  children: ReadonlyArray<Node>,
  ids: IdGen,
): DocumentNode {
  return { id: ids.next(), kind: "document", children };
}

// ─── Document-order iteration ──────────────────────────────────────────────

/**
 * All addressable nodes in document order (root excluded). Used to compute
 * "next/prev hole" and similar global walks.
 */
export function nodesInDocOrder(
  root: DocumentNode,
): ReadonlyArray<AddressableNode> {
  const out: AddressableNode[] = [];
  const walk = (n: Node): void => {
    if (n.kind !== "document") out.push(n);
    if (isCompoundOrDocument(n)) {
      for (const c of n.children) walk(c);
    }
  };
  for (const c of root.children) walk(c);
  return out;
}
