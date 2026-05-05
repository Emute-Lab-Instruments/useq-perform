/**
 * Meta operations (§6.6).
 *
 * Operations on the Meta stack of the focused node:
 *   - metaAdd(kind)  — push a new Meta onto the outermost position
 *   - metaRemove     — pop the outermost Meta
 *   - metaCycle      — advance the outermost Meta through a configurable cycle
 *   - metaFoldToggle — toggle visual fold state (display-only, no tree change)
 *
 * All meta ops are pure tree ops with type `(State) → OpResult`, matching the
 * pattern established in mutate.ts. They apply pointwise across the cursor set.
 */

import { findById } from "./traversal.ts";
import type {
  AddressableNode,
  Cursor,
  Meta,
  NoOpReason,
  NodeId,
  OpResult,
  State,
  Tree,
} from "./types.ts";
import { cursorList, makeTree } from "./types.ts";

// ─── Fold state (display-only) ────────────────────────────────────────────

/**
 * A set of node ids whose meta drawers are in the "folded" state.
 * This is a display concern that lives outside the tree; callers manage the
 * set and pass it through or store it alongside the State.
 *
 * For the pure core, foldToggle returns a directive rather than mutating UI.
 */
export type MetaFoldSet = Set<NodeId>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function resolveTarget(
  c: Cursor,
  tree: Tree,
): { node: AddressableNode; reason?: undefined } | { node?: undefined; reason: NoOpReason } {
  if (c.kind === "range") {
    // Meta ops don't apply to range cursors — act on the range's start node.
    // Actually per spec, meta ops target "the focused node". For a range cursor,
    // there's no single focused node. Treat as no-op.
    return { reason: "at-document-root" };
  }
  const n = findById(tree.root, c.target);
  if (n === null || n.kind === "document") return { reason: "at-document-root" };
  return { node: n as AddressableNode };
}

/**
 * Replace the metas on a node, returning a new node with the same id/kind/children.
 */
function withMetas(node: AddressableNode, metas: ReadonlyArray<Meta>): AddressableNode {
  switch (node.kind) {
    case "symbol":
      return { ...node, metas };
    case "number":
      return { ...node, metas };
    case "keyword":
      return { ...node, metas };
    case "string":
      return { ...node, metas };
    case "hole":
      return { ...node, metas };
    case "list":
      return { ...node, metas };
    case "vector":
      return { ...node, metas };
    case "map":
      return { ...node, metas };
    case "set":
      return { ...node, metas };
  }
}

import { replaceNode } from "./traversal.ts";

/**
 * Replace a node's metas in the tree, returning a new Tree.
 */
function replaceNodeMetasImpl(
  tree: Tree,
  nodeId: NodeId,
  newMetas: ReadonlyArray<Meta>,
): Tree {
  const node = findById(tree.root, nodeId);
  if (node === null || node.kind === "document") {
    throw new Error(`replaceNodeMetas: node ${nodeId} not addressable`);
  }
  const updated = withMetas(node as AddressableNode, newMetas);
  const newRoot = replaceNode(tree.root, nodeId, updated);
  return makeTree(newRoot);
}

// ─── Pointwise application (simplified for meta ops) ──────────────────────

/**
 * Meta ops don't need the full mutation pointwise machinery from mutate.ts
 * because they don't destroy nodes or change tree structure in ways that
 * would invalidate sibling cursors. Each cursor's target stays alive.
 */
function applyMetaOpPointwise(
  state: State,
  op: (c: Cursor, tree: Tree) => { tree: Tree; reason?: undefined } | { reason: NoOpReason },
): OpResult {
  const inputs = cursorList(state.cursors);
  const noOps: Array<{ cursor: Cursor; reason: NoOpReason }> = [];
  let currentTree = state.tree;

  for (const c of inputs) {
    const result = op(c, currentTree);
    if ("reason" in result && result.reason) {
      noOps.push({ cursor: c, reason: result.reason });
    } else if (result.tree) {
      currentTree = result.tree;
    }
  }

  return {
    state: { tree: currentTree, cursors: state.cursors },
    noOps,
  };
}

// ─── meta.add ─────────────────────────────────────────────────────────────

/**
 * Add a Meta of the given kind to the focused node.
 * The new meta is pushed to the outermost position (end of the metas array,
 * since innermost is first per §6.1).
 */
export function metaAdd(kind: string, payload: unknown = undefined): (s: State) => OpResult {
  return (s) =>
    applyMetaOpPointwise(s, (c, tree) => {
      const resolved = resolveTarget(c, tree);
      if (resolved.reason) return { reason: resolved.reason };
      const node = resolved.node;
      // Holes cannot bear metas (§2.9.6)
      if (node.kind === "hole") return { reason: "on-leaf" };
      const newMeta: Meta = { kind, payload };
      const newMetas = [...node.metas, newMeta];
      return { tree: replaceNodeMetasImpl(tree, node.id, newMetas) };
    });
}

// ─── meta.remove ──────────────────────────────────────────────────────────

/**
 * Remove the outermost Meta from the focused node.
 * The outermost Meta is the last in the array (innermost first per §6.1).
 * No-op if the node has no metas.
 */
export function metaRemove(s: State): OpResult {
  return applyMetaOpPointwise(s, (c, tree) => {
    const resolved = resolveTarget(c, tree);
    if (resolved.reason) return { reason: resolved.reason };
    const node = resolved.node;
    if (node.metas.length === 0) return { reason: "no-meta" };
    const newMetas = node.metas.slice(0, -1);
    return { tree: replaceNodeMetasImpl(tree, node.id, newMetas) };
  });
}

// ─── meta.cycle ───────────────────────────────────────────────────────────

/** Default cycle: quote → unquote → off (remove). */
export const DEFAULT_META_CYCLE: ReadonlyArray<string> = ["quote", "unquote"];

/**
 * Advance the outermost Meta through a configurable cycle of kinds.
 * Default cycle: quote → unquote → off (meta removed entirely).
 *
 * If the node has no metas, the first kind in the cycle is added.
 * If the outermost meta's kind is the last in the cycle, the meta is removed ("off").
 * If the outermost meta's kind is found in the cycle, it advances to the next.
 * If the outermost meta's kind is NOT in the cycle, it is replaced with the first cycle kind.
 */
export function metaCycle(
  cycle: ReadonlyArray<string> = DEFAULT_META_CYCLE,
): (s: State) => OpResult {
  return (s) =>
    applyMetaOpPointwise(s, (c, tree) => {
      const resolved = resolveTarget(c, tree);
      if (resolved.reason) return { reason: resolved.reason };
      const node = resolved.node;
      // Holes cannot bear metas
      if (node.kind === "hole") return { reason: "on-leaf" };

      if (node.metas.length === 0) {
        // No metas — add the first kind in the cycle.
        const newMeta: Meta = { kind: cycle[0], payload: undefined };
        return { tree: replaceNodeMetasImpl(tree, node.id, [newMeta]) };
      }

      const outermost = node.metas[node.metas.length - 1];
      const idx = cycle.indexOf(outermost.kind);

      if (idx === -1) {
        // Outermost kind not in cycle — replace it with first cycle kind.
        const newMetas = [
          ...node.metas.slice(0, -1),
          { kind: cycle[0], payload: undefined } as Meta,
        ];
        return { tree: replaceNodeMetasImpl(tree, node.id, newMetas) };
      }

      if (idx === cycle.length - 1) {
        // Last in cycle — "off": remove the outermost meta.
        const newMetas = node.metas.slice(0, -1);
        return { tree: replaceNodeMetasImpl(tree, node.id, newMetas) };
      }

      // Advance to next kind in cycle.
      const newMetas = [
        ...node.metas.slice(0, -1),
        { kind: cycle[idx + 1], payload: undefined } as Meta,
      ];
      return { tree: replaceNodeMetasImpl(tree, node.id, newMetas) };
    });
}

// ─── meta.foldToggle ──────────────────────────────────────────────────────

/**
 * Toggle drawer visibility for the focused node's Metas.
 *
 * This is a display-only operation — it does NOT change the tree. The fold
 * state is tracked externally (in the adapter's state field or a facet).
 * The pure core returns a result indicating which node ids should be toggled.
 *
 * We model this as a no-tree-change op that always "succeeds" (unless cursor
 * is on document root or a hole). The caller reads the `toggledNodes` from the
 * result to update its fold set.
 */
export interface MetaFoldToggleResult extends OpResult {
  /** Node ids whose fold state should be toggled. */
  readonly toggledNodes: ReadonlyArray<NodeId>;
}

export function metaFoldToggle(s: State): MetaFoldToggleResult {
  const inputs = cursorList(s.cursors);
  const noOps: Array<{ cursor: Cursor; reason: NoOpReason }> = [];
  const toggledNodes: NodeId[] = [];

  for (const c of inputs) {
    if (c.kind === "range") {
      noOps.push({ cursor: c, reason: "at-document-root" });
      continue;
    }
    const n = findById(s.tree.root, c.target);
    if (n === null || n.kind === "document") {
      noOps.push({ cursor: c, reason: "at-document-root" });
      continue;
    }
    if (n.metas.length === 0) {
      noOps.push({ cursor: c, reason: "no-meta" });
      continue;
    }
    toggledNodes.push(c.target);
  }

  return {
    state: s, // Tree unchanged — display-only operation.
    noOps,
    toggledNodes,
  };
}
