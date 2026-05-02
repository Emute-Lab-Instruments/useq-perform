/**
 * Concise tree builders for tests. Not part of the public surface.
 *
 * Each builder mints fresh ids via the supplied generator. Tests that need
 * a deterministic id sequence should call `__resetIdCounterForTests()` and
 * use `defaultIdGen()` so ids look like `n1`, `n2`, ...
 */

import type {
  AddressableNode,
  CompoundKind,
  HoleType,
  IdGen,
  Meta,
  Node,
  SymbolNode,
  NumberNode,
  KeywordNode,
  StringNode,
  HoleNode,
  Compound,
  DocumentNode,
  Tree,
  CursorSet,
  State,
} from "../types.ts";
import { makeTree, nodeCursor, singleCursor } from "../types.ts";
import { makeCompound, makeDocument } from "../traversal.ts";
import { makeHole } from "../holes.ts";

// ─── Leaf builders ─────────────────────────────────────────────────────────

export function sym(text: string, ids: IdGen, metas: Meta[] = []): SymbolNode {
  return { id: ids.next(), kind: "symbol", text, metas };
}
export function num(text: string, ids: IdGen, metas: Meta[] = []): NumberNode {
  return { id: ids.next(), kind: "number", text, metas };
}
export function kw(text: string, ids: IdGen, metas: Meta[] = []): KeywordNode {
  return { id: ids.next(), kind: "keyword", text, metas };
}
export function str(text: string, ids: IdGen, metas: Meta[] = []): StringNode {
  return { id: ids.next(), kind: "string", text, metas };
}
export function hole(name: string, t: HoleType, ids: IdGen): HoleNode {
  return makeHole(name, t, ids);
}

// ─── Compound builders ─────────────────────────────────────────────────────

function compound(
  kind: CompoundKind,
  ids: IdGen,
  metas: Meta[],
  children: ReadonlyArray<Node>,
): Compound {
  return makeCompound(kind, children, ids, metas);
}
export function list(ids: IdGen, ...children: AddressableNode[]): Compound {
  return compound("list", ids, [], children);
}
export function listWithMetas(
  ids: IdGen,
  metas: Meta[],
  ...children: AddressableNode[]
): Compound {
  return compound("list", ids, metas, children);
}
export function vec(ids: IdGen, ...children: AddressableNode[]): Compound {
  return compound("vector", ids, [], children);
}
export function map(ids: IdGen, ...children: AddressableNode[]): Compound {
  return compound("map", ids, [], children);
}
export function set(ids: IdGen, ...children: AddressableNode[]): Compound {
  return compound("set", ids, [], children);
}

// ─── Document + state builders ─────────────────────────────────────────────

export function doc(ids: IdGen, ...children: AddressableNode[]): DocumentNode {
  return makeDocument(children, ids);
}

export function tree(root: DocumentNode): Tree {
  return makeTree(root);
}

export function stateOn(root: DocumentNode, focusId: string): State {
  return { tree: tree(root), cursors: singleCursor(nodeCursor(focusId)) };
}

export function stateWithCursors(
  root: DocumentNode,
  cursors: CursorSet,
): State {
  return { tree: tree(root), cursors };
}

// ─── Inspection helpers ────────────────────────────────────────────────────

/**
 * Render a tree as a readable s-exprlike string for failure messages. Uses
 * brackets matching kind: () list, [] vector, {} map, #{} set, ⟨name:type⟩ hole.
 * Metas appear as `<kind|...>` prefixes.
 */
export function pp(n: Node): string {
  if (n.kind === "document") return n.children.map(pp).join(" ");
  const metas = n.metas.length === 0
    ? ""
    : "<" + n.metas.map((m) => m.kind).join("|") + ">";
  switch (n.kind) {
    case "symbol":
    case "number":
    case "keyword":
      return metas + n.text;
    case "string":
      return metas + n.text;
    case "hole":
      return metas + `⟨${n.name}:${n.holeType}⟩`;
    case "list":
      return metas + "(" + n.children.map(pp).join(" ") + ")";
    case "vector":
      return metas + "[" + n.children.map(pp).join(" ") + "]";
    case "map":
      return metas + "{" + n.children.map(pp).join(" ") + "}";
    case "set":
      return metas + "#{" + n.children.map(pp).join(" ") + "}";
  }
}
