/**
 * Mutation operations (§5.2).
 *
 * All mutations apply pointwise across the cursor set per §3.5: cursors are
 * applied in document order, leftmost first; after each application the
 * surviving cursors are remapped to the post-mutation tree (with id-based
 * cursors that's just an existence check); cursors whose target was destroyed
 * are dropped from the set with a `dropped` entry the caller may surface.
 *
 * Operations against the document root are atomic per §3.5 — they don't
 * interleave with sibling cursors. In practice, every mutation in this file
 * rejects the document root early (§2.4 / §5.3.2), so this concern is moot.
 *
 * Range-mutation variants (§5.2.10) are not implemented in this probe per
 * the task brief; the cursor type stays coherent because each pointwise op
 * either accepts a range explicitly (enclose, raise) or rejects with a
 * NoOpReason for ranges that aren't yet specified.
 */

import { findHolesInOrder, isHole } from "./holes.ts";
import {
  childrenOf,
  findById,
  indexOfChild,
  isCompound,
  makeCompound,
  parentOf,
  replaceChildren,
  replaceNode,
} from "./traversal.ts";
import type {
  AddressableNode,
  Compound,
  CompoundKind,
  Cursor,
  CursorSet,
  DocumentNode,
  IdGen,
  Meta,
  NoOpReason,
  Node,
  NodeId,
  OpResult,
  State,
  Tree,
} from "./types.ts";
import { cursorList, makeTree, nodeCursor } from "./types.ts";

// ─── Pointwise lift with cursor remap ──────────────────────────────────────

/**
 * A single-cursor mutation: returns either a new state with this cursor's
 * intended post-position, or a NoOpReason. The caller (the lift) is
 * responsible for fanning out across the cursor set, document-order ordering,
 * and dropping cursors whose targets were destroyed mid-fan.
 */
type SingleMutate = (c: Cursor, state: State) => Single;

interface SingleOk {
  readonly state: State;
  /** New cursor for the cursor that was just applied. */
  readonly cursor: Cursor;
}
interface SingleNoOp {
  readonly reason: NoOpReason;
}
type Single = SingleOk | SingleNoOp;

interface MutateResult extends OpResult {
  /** Cursors dropped because their targets were destroyed by an earlier op. */
  readonly dropped: ReadonlyArray<Cursor>;
}

function applyMutationPointwise(
  state: State,
  op: SingleMutate,
): MutateResult {
  const inputs = cursorList(state.cursors);
  // Order by document position so leftmost applies first (§3.5).
  const ordered = orderCursorsByDocPos(inputs, state.tree);
  // Remember original index so we can rebuild [primary, ...secondaries] order.
  const originalIndex = new Map<Cursor, number>();
  inputs.forEach((c, i) => originalIndex.set(c, i));

  let cur: State = state;
  const noOps: Array<{ cursor: Cursor; reason: NoOpReason }> = [];
  const dropped: Cursor[] = [];
  // After mutation, each input cursor may have moved. Track by original input
  // identity → resulting cursor (or null if dropped).
  const result: Array<Cursor | null> = inputs.map((c) => c);

  for (const c of ordered) {
    const idx = inputs.indexOf(c);
    if (idx < 0) continue;
    // Has the cursor been invalidated by an earlier mutation?
    if (!cursorAlive(result[idx]!, cur.tree)) {
      dropped.push(result[idx]!);
      result[idx] = null;
      continue;
    }
    const r = op(result[idx]!, cur);
    if ("reason" in r) {
      noOps.push({ cursor: result[idx]!, reason: r.reason });
      // Cursor unchanged; no tree change either.
      continue;
    }
    cur = r.state;
    result[idx] = r.cursor;
    // After the mutation, surviving cursors get checked at next iteration.
  }

  // Filter out dropped cursors. If everything was dropped, fall back to a
  // single cursor on the document root (§3.6).
  const survivors = result.filter((c): c is Cursor => c !== null);
  let cursors: CursorSet;
  if (survivors.length === 0) {
    cursors = { primary: nodeCursor(cur.tree.root.id), secondaries: [] };
  } else {
    cursors = { primary: survivors[0], secondaries: survivors.slice(1) };
  }
  return { state: { tree: cur.tree, cursors }, noOps, dropped };
}

/** Re-order cursors by document position of their focus id. */
function orderCursorsByDocPos(
  cs: ReadonlyArray<Cursor>,
  tree: Tree,
): ReadonlyArray<Cursor> {
  const positions = new Map<Cursor, number>();
  // Number every node in doc order; cursors point at one of them.
  const order = new Map<NodeId, number>();
  let i = 0;
  const walk = (n: Node): void => {
    if (n.kind !== "document") order.set(n.id, i++);
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
  walk(tree.root);
  for (const c of cs) {
    const id = c.kind === "node" ? c.target : c.start;
    positions.set(c, order.get(id) ?? Number.POSITIVE_INFINITY);
  }
  return [...cs].sort((a, b) => positions.get(a)! - positions.get(b)!);
}

function cursorAlive(c: Cursor, tree: Tree): boolean {
  if (c.kind === "node") return findById(tree.root, c.target) !== null;
  return (
    findById(tree.root, c.start) !== null &&
    findById(tree.root, c.end) !== null &&
    findById(tree.root, c.parent) !== null
  );
}

// ─── Per-op single-cursor implementations ──────────────────────────────────

// Most ops take a "config" with the id generator; we factor the lift out so
// each op can be tested in isolation. The exported API binds an id generator.

interface MutateConfig {
  readonly ids: IdGen;
  /** §5.2.9: governs atomSlurp on leaves. */
  readonly atomSlurpBehaviour?: "promote-to-vector" | "promote-to-list" | "no-op";
}

function targetCompound(
  c: Cursor,
  tree: Tree,
): { node: Compound; reason?: undefined } | { node?: undefined; reason: NoOpReason } {
  if (c.kind === "range") return { reason: "on-leaf" }; // ranges aren't single compounds
  const n = findById(tree.root, c.target);
  if (n === null) return { reason: "at-document-root" };
  if (n.kind === "document") return { reason: "at-document-root" };
  if (!isCompound(n)) return { reason: "on-leaf" };
  return { node: n };
}

function slurp(direction: "fwd" | "bwd"): SingleMutate {
  return (c, s) => {
    const tc = targetCompound(c, s.tree);
    if (tc.reason) return { reason: tc.reason };
    const L = tc.node;
    const parent = parentOf(s.tree.root, L.id);
    if (parent === null) return { reason: "at-document-root" };
    const idx = indexOfChild(s.tree.root, L.id);
    const siblings = parent.children;
    if (direction === "fwd") {
      if (idx + 1 >= siblings.length) return { reason: "no-next-sibling" };
      const sibling = siblings[idx + 1];
      // Build new compound with sibling appended; rebuild parent without sibling.
      const newL: Compound = withChildren(L, [...L.children, sibling]);
      const newSiblings = [
        ...siblings.slice(0, idx),
        newL,
        ...siblings.slice(idx + 2),
      ];
      const newRoot = replaceChildren(s.tree.root, parent.id, newSiblings);
      return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(newL.id) };
    } else {
      if (idx === 0) return { reason: "no-prev-sibling" };
      const sibling = siblings[idx - 1];
      const newL: Compound = withChildren(L, [sibling, ...L.children]);
      const newSiblings = [
        ...siblings.slice(0, idx - 1),
        newL,
        ...siblings.slice(idx + 1),
      ];
      const newRoot = replaceChildren(s.tree.root, parent.id, newSiblings);
      return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(newL.id) };
    }
  };
}

function barf(direction: "fwd" | "bwd"): SingleMutate {
  return (c, s) => {
    const tc = targetCompound(c, s.tree);
    if (tc.reason) return { reason: tc.reason };
    const L = tc.node;
    const parent = parentOf(s.tree.root, L.id);
    if (parent === null) return { reason: "at-document-root" };
    if (L.children.length < 2) return { reason: "fewer-than-two-children" };
    const idx = indexOfChild(s.tree.root, L.id);
    const siblings = parent.children;
    if (direction === "fwd") {
      const last = L.children[L.children.length - 1];
      const newL: Compound = withChildren(L, L.children.slice(0, -1));
      const newSiblings = [
        ...siblings.slice(0, idx),
        newL,
        last,
        ...siblings.slice(idx + 1),
      ];
      const newRoot = replaceChildren(s.tree.root, parent.id, newSiblings);
      return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(newL.id) };
    } else {
      const first = L.children[0];
      const newL: Compound = withChildren(L, L.children.slice(1));
      const newSiblings = [
        ...siblings.slice(0, idx),
        first,
        newL,
        ...siblings.slice(idx + 1),
      ];
      const newRoot = replaceChildren(s.tree.root, parent.id, newSiblings);
      return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(newL.id) };
    }
  };
}

const raise: SingleMutate = (c, s) => {
  // §5.2.5: cursor on N whose parent is not the document root. N replaces
  // its parent (the parent and other siblings are removed).
  if (c.kind === "range") return { reason: "on-leaf" }; // not implemented for ranges
  const N = findById(s.tree.root, c.target);
  if (N === null || N.kind === "document") return { reason: "at-document-root" };
  const parent = parentOf(s.tree.root, N.id);
  if (parent === null) return { reason: "at-document-root" };
  if (parent.kind === "document") {
    // Per spec: "parent is not the document root". Top-level forms can't be
    // raised because the parent IS the document.
    return { reason: "single-top-level" };
  }
  // N replaces parent. The replacement carries N's own metas; parent's metas
  // are dropped per §5.2.5 ("the parent and its other children are removed").
  const newRoot = replaceNode(s.tree.root, parent.id, N as AddressableNode);
  return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(N.id) };
};

const splice: SingleMutate = (c, s) => {
  // §5.2.6: cursor on compound L (not document root). L's children become
  // siblings of L in the parent; L is removed. Cursor moves to first spliced
  // child. Splicing a top-level `do` form into the document root is allowed.
  const tc = targetCompound(c, s.tree);
  if (tc.reason) return { reason: tc.reason };
  const L = tc.node;
  const parent = parentOf(s.tree.root, L.id);
  if (parent === null) return { reason: "at-document-root" };
  if (L.children.length === 0) {
    // Splicing an empty compound just removes it. Cursor relocates to parent
    // per §3.6 / §5.3 spirit (no spliced children to land on).
    const newKids = parent.children.filter((k) => k.id !== L.id);
    const newRoot = replaceChildren(s.tree.root, parent.id, newKids);
    return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(parent.id) };
  }
  const idx = indexOfChild(s.tree.root, L.id);
  const newKids = [
    ...parent.children.slice(0, idx),
    ...L.children,
    ...parent.children.slice(idx + 1),
  ];
  const newRoot = replaceChildren(s.tree.root, parent.id, newKids);
  return {
    state: stateOf(newRoot, s.cursors),
    cursor: nodeCursor(L.children[0].id),
  };
};

function enclose(kind: CompoundKind, ids: IdGen): SingleMutate {
  return (c, s) => {
    // §5.2.7: a fresh compound of the requested kind is created with N as
    // its sole child, replacing N in the parent. Range-cursor variant
    // (§5.2.10) wraps the entire run.
    if (c.kind === "node") {
      const N = findById(s.tree.root, c.target);
      if (N === null || N.kind === "document") {
        return { reason: "at-document-root" };
      }
      // N must be addressable (compound or leaf) — guaranteed since we
      // excluded document.
      const wrapper: Compound = makeCompound(kind, [N as AddressableNode], ids);
      const newRoot = replaceNode(s.tree.root, N.id, wrapper);
      return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(wrapper.id) };
    } else {
      const parent = findById(s.tree.root, c.parent);
      if (parent === null || !isCompound(parent)) {
        return { reason: "at-document-root" };
      }
      const startIdx = parent.children.findIndex((k) => k.id === c.start);
      const endIdx = parent.children.findIndex((k) => k.id === c.end);
      if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) {
        return { reason: "at-document-root" };
      }
      const run = parent.children.slice(startIdx, endIdx + 1) as
        AddressableNode[];
      const wrapper: Compound = makeCompound(kind, run, ids);
      const newKids = [
        ...parent.children.slice(0, startIdx),
        wrapper,
        ...parent.children.slice(endIdx + 1),
      ];
      const newRoot = replaceChildren(s.tree.root, parent.id, newKids);
      return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(wrapper.id) };
    }
  };
}

function transpose(direction: "next" | "prev"): SingleMutate {
  return (c, s) => {
    if (c.kind === "range") return { reason: "on-leaf" };
    const N = findById(s.tree.root, c.target);
    if (N === null || N.kind === "document") return { reason: "at-document-root" };
    const parent = parentOf(s.tree.root, N.id);
    if (parent === null) return { reason: "at-document-root" };
    const idx = indexOfChild(s.tree.root, N.id);
    const sibIdx = direction === "next" ? idx + 1 : idx - 1;
    if (sibIdx < 0) return { reason: "no-prev-sibling" };
    if (sibIdx >= parent.children.length) return { reason: "no-next-sibling" };
    const newKids = parent.children.slice() as Node[];
    const tmp = newKids[idx];
    newKids[idx] = newKids[sibIdx];
    newKids[sibIdx] = tmp;
    const newRoot = replaceChildren(s.tree.root, parent.id, newKids);
    return { state: stateOf(newRoot, s.cursors), cursor: nodeCursor(N.id) };
  };
}

function fillHoleOp(replacementFactory: (ids: IdGen) => AddressableNode, ids: IdGen): SingleMutate {
  return (c, s) => {
    if (c.kind === "range") return { reason: "not-on-hole" };
    const target = findById(s.tree.root, c.target);
    if (target === null || !isHole(target)) return { reason: "not-on-hole" };
    const replacement = replacementFactory(ids);
    if (replacement.kind === "hole" && replacement.id === target.id) {
      throw new Error("fillHole: replacement reuses the hole's own id");
    }
    const newRoot = replaceNode(s.tree.root, target.id, replacement);
    // §5.2.11: cursor moves to inserted content, OR to its first hole.
    const innerHoles = findHolesInOrder(replacement);
    const cursorTarget = innerHoles.length > 0 ? innerHoles[0].id : replacement.id;
    return {
      state: stateOf(newRoot, s.cursors),
      cursor: nodeCursor(cursorTarget),
    };
  };
}

function atomSlurp(
  direction: "fwd" | "bwd",
  cfg: MutateConfig,
): SingleMutate {
  return (c, s) => {
    if (c.kind === "range") return { reason: "on-leaf" };
    const target = findById(s.tree.root, c.target);
    if (target === null || target.kind === "document") {
      return { reason: "at-document-root" };
    }
    if (isCompound(target)) {
      // Already a compound; do a regular slurp.
      return slurp(direction)(c, s);
    }
    // Leaf — promote per §5.2.9.
    const promote = cfg.atomSlurpBehaviour ?? "promote-to-vector";
    if (promote === "no-op") return { reason: "atom-slurp-disabled" };
    const compoundKind: CompoundKind =
      promote === "promote-to-list" ? "list" : "vector";
    // Wrap the leaf in a singleton compound, then slurp.
    const wrapper = makeCompound(compoundKind, [target], cfg.ids);
    const promoted = replaceNode(s.tree.root, target.id, wrapper);
    const promotedTree = makeTree(promoted);
    // Now slurp on the wrapper.
    const newCursor = nodeCursor(wrapper.id);
    return slurp(direction)(newCursor, {
      tree: promotedTree,
      cursors: s.cursors,
    });
  };
}

// ─── Cursor invalidation note ──────────────────────────────────────────────

// `applyMutationPointwise` already drops dead cursors. Nothing to do here.

// ─── Public ops, factory-style so tests can inject id generators ──────────

export interface Mutators {
  slurpForward(s: State): MutateResult;
  slurpBackward(s: State): MutateResult;
  barfForward(s: State): MutateResult;
  barfBackward(s: State): MutateResult;
  raise(s: State): MutateResult;
  splice(s: State): MutateResult;
  enclose: {
    list(s: State): MutateResult;
    vector(s: State): MutateResult;
    map(s: State): MutateResult;
    set(s: State): MutateResult;
  };
  transposeNext(s: State): MutateResult;
  transposePrev(s: State): MutateResult;
  /**
   * Replace the focused hole with a fresh node produced by `factory`. The
   * factory is called once per cursor on a hole.
   */
  fillHole(s: State, factory: (ids: IdGen) => AddressableNode): MutateResult;
  atomSlurpForward(s: State): MutateResult;
  atomSlurpBackward(s: State): MutateResult;
}

export function makeMutators(cfg: MutateConfig): Mutators {
  return {
    slurpForward: (s) => applyMutationPointwise(s, slurp("fwd")),
    slurpBackward: (s) => applyMutationPointwise(s, slurp("bwd")),
    barfForward: (s) => applyMutationPointwise(s, barf("fwd")),
    barfBackward: (s) => applyMutationPointwise(s, barf("bwd")),
    raise: (s) => applyMutationPointwise(s, raise),
    splice: (s) => applyMutationPointwise(s, splice),
    enclose: {
      list: (s) => applyMutationPointwise(s, enclose("list", cfg.ids)),
      vector: (s) => applyMutationPointwise(s, enclose("vector", cfg.ids)),
      map: (s) => applyMutationPointwise(s, enclose("map", cfg.ids)),
      set: (s) => applyMutationPointwise(s, enclose("set", cfg.ids)),
    },
    transposeNext: (s) => applyMutationPointwise(s, transpose("next")),
    transposePrev: (s) => applyMutationPointwise(s, transpose("prev")),
    fillHole: (s, factory) =>
      applyMutationPointwise(s, fillHoleOp(factory, cfg.ids)),
    atomSlurpForward: (s) => applyMutationPointwise(s, atomSlurp("fwd", cfg)),
    atomSlurpBackward: (s) => applyMutationPointwise(s, atomSlurp("bwd", cfg)),
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

/** Return a copy of compound `c` with new children, preserving id, kind, metas. */
function withChildren(c: Compound, kids: ReadonlyArray<Node>): Compound {
  switch (c.kind) {
    case "list":
      return { id: c.id, kind: "list", metas: c.metas, children: kids };
    case "vector":
      return { id: c.id, kind: "vector", metas: c.metas, children: kids };
    case "map":
      return { id: c.id, kind: "map", metas: c.metas, children: kids };
    case "set":
      return { id: c.id, kind: "set", metas: c.metas, children: kids };
  }
}

function stateOf(root: DocumentNode, cursors: CursorSet): State {
  return { tree: makeTree(root), cursors };
}

// Re-export Meta type so callers can see it without a deeper import.
export type { Meta };
