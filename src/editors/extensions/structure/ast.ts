// Pure AST navigation helpers and re-exports from new-structure.
// No CodeMirror decoration or eval side-effect dependencies.

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
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
