// Pure AST navigation helpers and re-exports from new-structure.
// No CodeMirror decoration or eval side-effect dependencies.

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import {
  findNodeAt,
  navigationMetaField,
  navigationMetaEffect,
  navigateIn,
  navigateOut,
  navigateNext,
  navigatePrev,
  navigateRight,
  navigateLeft,
  navigateUp,
  navigateDown,
  isContainerNode as isContainerNodeInternal,
  isStructuralToken as isStructuralTokenInternal,
} from "./new-structure.ts";
import type { HoleType } from "../../../contracts/editorChannels";

// Re-export navigation functions
export {
  findNodeAt,
  navigationMetaField,
  navigationMetaEffect,
  navigateIn,
  navigateOut,
  navigateNext,
  navigatePrev,
  navigateRight,
  navigateLeft,
  navigateUp,
  navigateDown,
};

// --- Backward-compatible utility exports ---

const STRUCTURAL_TOKEN_NAMES = new Set([
  "(", ")", "[", "]", "{", "}", "Brace", "Bracket", "Paren",
  "#", "'", "LineComment", "BlockComment", "Comment",
]);

const CONTAINER_NODE_NAMES = new Set([
  "List", "Vector", "Program", "Map", "Set",
]);

export function isStructuralToken(nodeOrToken: any): boolean {
  if (!nodeOrToken) return false;
  if (typeof nodeOrToken === "string") {
    return STRUCTURAL_TOKEN_NAMES.has(nodeOrToken);
  }
  if (nodeOrToken?.type && typeof nodeOrToken.type === "string") {
    return isStructuralToken(nodeOrToken.type);
  }
  return isStructuralTokenInternal(nodeOrToken);
}

export function isContainerNode(node: any): boolean {
  if (!node) return false;
  if (typeof node.type === "string") {
    return CONTAINER_NODE_NAMES.has(node.type);
  }
  return isContainerNodeInternal(node);
}

export function isOperatorNode(node: any): boolean {
  return Boolean(
    node &&
      node.type === "Operator" &&
      Array.isArray(node.children) &&
      node.children.length > 0,
  );
}

/**
 * Helper to trim whitespace and get adjusted range from a syntax node.
 */
export function getTrimmedRange(
  node: { from: number; to: number } | null | undefined,
  state: EditorState,
): { from: number; to: number } | null {
  if (!node || typeof node.from !== "number" || typeof node.to !== "number")
    return null;
  const text = state.sliceDoc(node.from, node.to);
  let startOffset = 0;
  let endOffset = text.length;
  while (startOffset < endOffset && /\s/.test(text[startOffset])) startOffset++;
  while (endOffset > startOffset && /\s/.test(text[endOffset - 1])) endOffset--;
  if (startOffset >= endOffset) return null;
  return {
    from: node.from + startOffset,
    to: node.from + endOffset,
  };
}

/**
 * Walk up to the nearest container node (List/Vector/Map/Set/Program) at a position.
 */
export function getContainerNodeAt(state: EditorState, pos: number): any {
  const tree = syntaxTree(state);
  let node: any = tree.resolveInner(pos, 0);
  while (node && node.parent && !isContainerNode(node)) {
    node = node.parent;
  }
  return node && isContainerNode(node) ? node : null;
}

// ── Hole detection ─────────────────────────────────────────────
//
// A hole is a list matching the shape `($ <symbol> <:keyword>)` per
// structural-editing.md §2.9.1.  We detect it by examining the Lezer parse
// tree: a 3-element List whose first child text is "$", second is a Symbol,
// and third is a Keyword.

/** Valid hole types per the structural ontology. */
const VALID_HOLE_TYPES: ReadonlySet<string> = new Set([
  "number", "symbol", "keyword", "string", "expr",
]);

/** Parsed representation of a hole node. */
export interface ParsedHole {
  name: string;
  type: HoleType;
  from: number;
  to: number;
}

/**
 * Check whether a syntax node represents a hole `($ name :type)`.
 * Returns the parsed hole info if so, null otherwise.
 */
export function parseHoleNode(
  node: SyntaxNode | null | undefined,
  state: EditorState,
): ParsedHole | null {
  if (!node) return null;

  // Holes are Lists in the Lezer parse tree
  if (node.type.name !== "List") return null;

  // Gather non-structural children
  const children: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (!cursor.firstChild()) return null;
  do {
    if (!isStructuralTokenInternal(cursor.node)) {
      children.push(cursor.node);
    }
  } while (cursor.nextSibling());

  // Must have exactly 3 logical children: $, name, :type
  if (children.length !== 3) return null;

  const [head, nameNode, typeNode] = children;

  // Head must be the literal symbol "$"
  const headText = state.sliceDoc(head.from, head.to);
  if (headText !== "$") return null;

  // Second must be a Symbol (the hole name)
  if (nameNode.type.name !== "Symbol") return null;
  const name = state.sliceDoc(nameNode.from, nameNode.to);

  // Third must be a Keyword (the hole type)
  if (typeNode.type.name !== "Keyword") return null;
  const typeText = state.sliceDoc(typeNode.from, typeNode.to);

  // Keywords start with ":" — strip it
  const typeName = typeText.startsWith(":") ? typeText.slice(1) : typeText;
  if (!VALID_HOLE_TYPES.has(typeName)) return null;

  return {
    name,
    type: typeName as HoleType,
    from: node.from,
    to: node.to,
  };
}

/**
 * Convenience: check if the cursor's current node is a hole.
 * Resolves the node at the selection and attempts to parse it as a hole.
 * Walks up through ancestors in case the cursor is on a child of the hole list.
 */
export function getHoleAtCursor(state: EditorState): ParsedHole | null {
  const sel = state.selection.main;

  // Try resolving via findNodeAt (structural navigation's resolver)
  const node = findNodeAt(state, sel.from, sel.to) as SyntaxNode | null;
  if (node) {
    // Direct hit: the selected node IS the hole list
    const direct = parseHoleNode(node, state);
    if (direct) return direct;

    // Walk up ancestors — cursor may be on a child of the hole
    let ancestor: SyntaxNode | null = node.parent;
    while (ancestor && ancestor.type.name !== "Program") {
      const hole = parseHoleNode(ancestor, state);
      if (hole) return hole;
      ancestor = ancestor.parent;
    }
  }

  // Fallback: resolve directly from the syntax tree at the cursor position.
  // findNodeAt may return null in edge cases where the cursor is between nodes.
  const tree = syntaxTree(state);
  let resolved: SyntaxNode | null = tree.resolveInner(sel.from, 1);
  while (resolved && resolved.type.name !== "Program") {
    const hole = parseHoleNode(resolved, state);
    if (hole) return hole;
    resolved = resolved.parent;
  }

  return null;
}

/**
 * Apply a navigation function to a view, preserving navigation metadata.
 *
 * @returns true if navigation occurred (state changed), false otherwise
 */
export function performNavigation(
  view: EditorView,
  navFunction: (state: EditorState) => EditorState,
): boolean {
  const newState = navFunction(view.state);
  if (newState === view.state) return false;

  let newMeta: any = null;
  try {
    newMeta = newState.field(navigationMetaField);
  } catch (e) {
    console.error("performNavigation: Failed to retrieve navigationMetaField", e);
  }

  const transactionSpec: any = {
    selection: newState.selection,
    scrollIntoView: true,
  };

  if (newMeta) {
    transactionSpec.effects = navigationMetaEffect.of(newMeta);
  } else {
    console.warn(
      "performNavigation: newMeta is null or undefined, navigation history might be lost",
    );
  }

  view.dispatch(transactionSpec);
  return true;
}
