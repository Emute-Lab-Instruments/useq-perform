// Lezer/AST helpers for callers outside the structural-editing core.
//
// The legacy `structure/new-structure.ts` and `structure/ast.ts` modules used
// to host these helpers; they were retired together with the rest of the
// legacy structural-editing implementation, and the helpers — which are pure,
// stateless functions over a Lezer syntax tree — moved here.

import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";

// ── Token / node classification ────────────────────────────────────────────

const STRUCTURAL_TOKEN_TYPES = new Set([
  "(", ")", "[", "]", "{", "}",
  "Brace", "Bracket", "Paren",
  "#", "'",
  "LineComment", "BlockComment", "Comment",
]);

const CONTAINER_NODE_TYPES = new Set(["List", "Vector", "Map", "Set"]);

/** True if `node` is a structural token (paren, bracket, comment, quote, …). */
export function isStructuralToken(node: SyntaxNode): boolean {
  return STRUCTURAL_TOKEN_TYPES.has(node.type.name);
}

/** True if `node` is a container/compound node (List, Vector, Map, Set). */
export function isContainerNode(node: SyntaxNode | null): boolean {
  if (!node) return false;
  return CONTAINER_NODE_TYPES.has(node.type.name);
}

/**
 * True if `node` is an operator with at least one child. Mirrors the legacy
 * `isOperatorNode` predicate that callers expect; intentionally permissive
 * about input shape (consults `node.type` and `node.children`).
 */
export function isOperatorNode(node: any): boolean {
  return Boolean(
    node &&
      node.type === "Operator" &&
      Array.isArray(node.children) &&
      node.children.length > 0,
  );
}

// ── Range helpers ──────────────────────────────────────────────────────────

/**
 * Trim leading/trailing whitespace from a node's range and return the
 * tightened bounds. Returns null if the trimmed range is empty.
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
 * Walk up to the nearest container node (List/Vector/Map/Set/Program) at a
 * position. Returns the container node, or null if none found.
 */
export function getContainerNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, 0);
  while (node && node.parent && !isContainerNode(node)) {
    node = node.parent;
  }
  return node && isContainerNode(node) ? node : null;
}

// ── Node-at-position resolution ────────────────────────────────────────────

/**
 * Find a syntax node at a given position/range. Mirrors the legacy
 * `findNodeAt` resolver used by code-evaluation, expression-bounds detection,
 * and the legacy structural-editing implementation.
 *
 * Range mode (to > from): returns the node whose range exactly matches
 * [from, to], walking up the tree from a deep `resolveInner` hit. Returns
 * null if no node spans exactly that range.
 *
 * Point mode (to == from): returns the leaf at the position when the cursor
 * sits on a leaf, otherwise the nearest neighbouring child of the enclosing
 * container, with these adjacency rules:
 *
 *   - On a node boundary (left or right edge of a child) → that child
 *   - One whitespace char away from a single child → that child
 *   - Equally close (1 char) to children on both sides → null (contested)
 *   - Otherwise far from any child → null
 */
export function findNodeAt(
  state: EditorState,
  from: number,
  to: number = from,
): SyntaxNode | null {
  try {
    const tree = syntaxTree(state);

    // Range selection: find a node that exactly matches [from, to].
    if (to > from) {
      let node: SyntaxNode | null = tree.resolveInner(from, 1);
      if (!node || node.from < from || node.to > to) {
        node = tree.resolveInner(from, -1);
      }
      if (!node || node.from < from || node.to > to) {
        node = tree.resolveInner(from, 0);
      }

      while (node) {
        if (node.from === from && node.to === to) {
          return node;
        }
        if (node.from < from || node.to > to) {
          break;
        }
        node = node.parent;
      }

      return null;
    }

    // Point selection.
    const node = tree.resolveInner(from, 0);

    if (!isContainerNode(node) && node.type.name !== "Program") {
      return node;
    }

    // We're inside a container/program — walk children to find the closest
    // logical neighbour.
    let leftChild: SyntaxNode | null = null;
    let rightChild: SyntaxNode | null = null;

    const cursor = node.cursor();
    if (cursor.firstChild()) {
      do {
        if (isStructuralToken(cursor.node)) continue;

        if (cursor.to <= from) {
          leftChild = cursor.node;
        } else if (cursor.from >= from) {
          rightChild = cursor.node;
          break;
        }
      } while (cursor.nextSibling());
    }

    const leftDist = leftChild ? from - leftChild.to : Infinity;
    const rightDist = rightChild ? rightChild.from - from : Infinity;

    if (rightDist === 0) return rightChild;
    if (leftDist === 0) return leftChild;

    if (leftDist === 1) {
      if (rightDist <= 1) return null;
      return leftChild;
    }

    if (rightDist === 1) {
      if (leftDist <= 1) return null;
      return rightChild;
    }

    return null;
  } catch (e) {
    console.error("findNodeAt: Error resolving node", e);
    return null;
  }
}
