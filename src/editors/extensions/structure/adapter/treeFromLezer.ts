/**
 * Folds a Lezer parse tree into a structural-editing core Tree.
 *
 * Round-2 simplifications (documented in the brief and the run report):
 *   - Fresh ids minted on every parse. Cursor stability across re-parses is
 *     handled separately by `cursorPath.ts` (structural path, not id).
 *   - Comments and strings of structural-token cruft are skipped per the
 *     existing `iterateLogicalChildren` rules in `new-structure.ts`.
 *   - Holes aren't materialised; the spec defers hole rendering. If textual
 *     hole syntax appears it'll just parse as ordinary nodes for now.
 *
 * Builds an `idIndex: Map<NodeId, {from, to}>` alongside the tree so the
 * decoration extension can paint halos and the apply layer can replace the
 * source range of a top-level form.
 */
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

import {
  defaultIdGen,
  makeTree,
  type DocumentNode,
  type IdGen,
  type Node,
  type NodeId,
  type Tree,
} from "../core/index.ts";

/** Source range for an id, used for halos and text replacement. */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export type IdIndex = ReadonlyMap<NodeId, SourceRange>;

export interface ParseResult {
  readonly tree: Tree;
  readonly idIndex: IdIndex;
}

// Names skipped when building child arrays — they're punctuation/comments.
const STRUCTURAL_TOKEN_NAMES = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "Brace",
  "Bracket",
  "Paren",
  "#",
  "'",
  "LineComment",
  "BlockComment",
  "Comment",
]);

function isStructuralToken(node: SyntaxNode): boolean {
  return STRUCTURAL_TOKEN_NAMES.has(node.type.name);
}

/**
 * Convert a Lezer SyntaxNode into a core Node, recursively. Returns null when
 * the lezer node is structural (skip it).
 */
function convert(
  node: SyntaxNode,
  state: EditorState,
  ids: IdGen,
  idIndex: Map<NodeId, SourceRange>,
): Node | null {
  if (isStructuralToken(node)) return null;

  const name = node.type.name;
  const id = ids.next();
  idIndex.set(id, { from: node.from, to: node.to });

  // Compounds: List / Vector / Map / Set
  if (name === "List" || name === "Vector" || name === "Map" || name === "Set") {
    const children: Node[] = [];
    let cur = node.firstChild;
    while (cur) {
      // §iterateLogicalChildren parity: Set wraps a Map in clojure-mode.
      // Flatten the Map's children directly into the Set's children.
      if (name === "Set" && cur.type.name === "Map") {
        let inner = cur.firstChild;
        while (inner) {
          const child = convert(inner, state, ids, idIndex);
          if (child !== null) children.push(child);
          inner = inner.nextSibling;
        }
      } else {
        const child = convert(cur, state, ids, idIndex);
        if (child !== null) children.push(child);
      }
      cur = cur.nextSibling;
    }
    const kind: "list" | "vector" | "map" | "set" =
      name === "List" ? "list"
      : name === "Vector" ? "vector"
      : name === "Map" ? "map"
      : "set";
    return { id, kind, metas: [], children };
  }

  // Leaves
  const text = state.doc.sliceString(node.from, node.to);
  if (name === "Number") {
    return { id, kind: "number", metas: [], text };
  }
  if (name === "Keyword") {
    return { id, kind: "keyword", metas: [], text };
  }
  if (name === "String") {
    return { id, kind: "string", metas: [], text };
  }
  // Default: treat as a symbol. Operator/Symbol/etc all collapse to symbol
  // for round-2 purposes — the printer round-trips by raw text.
  return { id, kind: "symbol", metas: [], text };
}

/**
 * Fold the Lezer parse tree into a core Tree. The Lezer root in clojure-mode
 * is "Program"; its top-level children become the document's children.
 */
export function treeFromLezer(state: EditorState): ParseResult {
  const ids = defaultIdGen();
  const idIndex = new Map<NodeId, SourceRange>();
  const lezerRoot = syntaxTree(state).topNode;

  const docId = ids.next();
  // Document range covers the whole doc.
  idIndex.set(docId, { from: 0, to: state.doc.length });

  const children: Node[] = [];
  let cur = lezerRoot.firstChild;
  while (cur) {
    const child = convert(cur, state, ids, idIndex);
    if (child !== null) children.push(child);
    cur = cur.nextSibling;
  }

  const root: DocumentNode = { id: docId, kind: "document", children };
  return { tree: makeTree(root), idIndex };
}
