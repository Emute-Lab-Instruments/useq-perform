/**
 * New Structural Editing Extensions for CodeMirror
 * 
 * This module creates a self-contained extension for CodeMirror that wraps/includes
 * the nextjournal clojure-mode extension and implements structural navigation and
 * editing features required by the YAML test cases.
 */

import { EditorState, EditorSelection } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { default_extensions } from '@nextjournal/clojure-mode';

// Global clipboard for cut/paste operations
let clipboardContent = null;

/**
 * Creates a headless CodeMirror editor state with clojure-mode extensions
 * @param {string} doc - Initial document content
 * @returns {EditorState} - The editor state
 */
export function createStructuralEditor(doc = '') {
  return EditorState.create({
    doc,
    extensions: default_extensions
  });
}

/**
 * Helper function to get the syntax tree for a state
 * @param {EditorState} state - Editor state
 * @returns {Tree} - Syntax tree
 */
function getTree(state) {
  return syntaxTree(state);
}

/**
 * Helper function to find a node at a given position/range
 * @param {EditorState} state - Editor state  
 * @param {number} from - Start position
 * @param {number} to - End position (optional)
 * @returns {SyntaxNode|null} - Node at position or null
 */
function findNodeAt(state, from, to = from) {
  const tree = getTree(state);
  
  // If we have a range selection, try to find a node that exactly matches
  if (to > from) {
    let bestMatch = null;
    tree.iterate({
      enter(node) {
        if (node.from === from && node.to === to) {
          bestMatch = node.node;
          return false; // Stop iteration
        }
      }
    });
    if (bestMatch) return bestMatch;
  }
  
  // Fall back to resolveInner with preference for start
  return tree.resolveInner(from, 1);
}

/**
 * Helper function to check if a node is a structural token
 * @param {SyntaxNode} node - Node to check
 * @returns {boolean} - True if structural
 */
function isStructuralToken(node) {
  const structuralTypes = ['(', ')', '[', ']', '{', '}', 'Brace', 'Bracket', 'Paren'];
  return structuralTypes.includes(node.type.name);
}

/**
 * Find the next sibling of a node, skipping structural tokens
 * @param {SyntaxNode} node - Current node
 * @returns {SyntaxNode|null} - Next sibling or null
 */
function getNextSibling(node) {
  if (!node.parent) return null;
  
  let found = false;
  let cursor = node.parent.cursor();
  
  if (cursor.firstChild()) {
    do {
      // Skip structural tokens
      if (isStructuralToken(cursor.node)) {
        continue;
      }
      
      if (found) {
        return cursor.node;
      }
      if (cursor.from === node.from && cursor.to === node.to) {
        found = true;
      }
    } while (cursor.nextSibling());
  }
  
  return null;
}

/**
 * Find the previous sibling of a node, skipping structural tokens
 * @param {SyntaxNode} node - Current node
 * @returns {SyntaxNode|null} - Previous sibling or null
 */
function getPrevSibling(node) {
  if (!node.parent) return null;
  
  let prev = null;
  let cursor = node.parent.cursor();
  
  if (cursor.firstChild()) {
    do {
      // Skip structural tokens
      if (isStructuralToken(cursor.node)) {
        continue;
      }
      
      if (cursor.from === node.from && cursor.to === node.to) {
        return prev;
      }
      prev = cursor.node;
    } while (cursor.nextSibling());
  }
  
  return null;
}

/**
 * Helper function to get text content of a node
 * @param {EditorState} state - Editor state
 * @param {SyntaxNode} node - Syntax node
 * @returns {string} - Text content
 */
function getNodeText(state, node) {
  return state.sliceDoc(node.from, node.to);
}

/**
 * Helper function to find node by text content within current selection context
 * @param {EditorState} state - Editor state
 * @param {string} text - Text to find
 * @returns {SyntaxNode|null} - Found node or null
 */
function findNodeByText(state, text) {
  const tree = getTree(state);
  let found = null;
  
  tree.iterate({
    enter(node) {
      if (getNodeText(state, node.node) === text) {
        found = node.node;
        return false; // Stop iteration
      }
    }
  });
  
  return found;
}

/**
 * Navigation Functions
 */

/**
 * Navigate to next sibling at the same level
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateNext(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  const nextNode = getNextSibling(currentNode);
  if (!nextNode) {
    return state; // No change if at boundary
  }
  
  return state.update({
    selection: EditorSelection.single(nextNode.from, nextNode.to)
  }).state;
}

/**
 * Navigate to previous sibling at the same level
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigatePrevious(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  const prevNode = getPrevSibling(currentNode);
  if (!prevNode) {
    return state; // No change if at boundary
  }
  
  return state.update({
    selection: EditorSelection.single(prevNode.from, prevNode.to)
  }).state;
}

/**
 * Navigate into the first child of current node
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateIn(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  const cursor = currentNode.cursor();
  if (cursor.firstChild()) {
    const firstChild = cursor.node;
    return state.update({
      selection: EditorSelection.single(firstChild.from, firstChild.to)
    }).state;
  }
  
  return state; // No change if no children
}

/**
 * Navigate out to the parent of current node
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateOut(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode || !currentNode.parent) {
    return state; // No change if at root
  }
  
  const parent = currentNode.parent;
  return state.update({
    selection: EditorSelection.single(parent.from, parent.to)
  }).state;
}

/**
 * Navigate spatially to the right (entering/exiting expressions)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateRight(state) {
  // For now, implement as next sibling with entry capability
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  // If we can enter the current node, do so
  if (currentNode.firstChild && isContainerNode(currentNode)) {
    return navigateIn(state);
  }
  
  // Otherwise try to go to next sibling
  if (currentNode.nextSibling) {
    return navigateNext(state);
  }
  
  // Try to exit and continue
  if (currentNode.parent && currentNode.parent.nextSibling) {
    const parent = currentNode.parent;
    return state.update({
      selection: EditorSelection.single(parent.nextSibling.from, parent.nextSibling.to)
    }).state;
  }
  
  return state;
}

/**
 * Navigate spatially to the left (entering/exiting expressions)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  // Try to go to previous sibling
  if (currentNode.prevSibling) {
    return navigatePrevious(state);
  }
  
  // Try to exit to parent
  if (currentNode.parent) {
    return navigateOut(state);
  }
  
  return state;
}

/**
 * Navigate up (vertical navigation maintaining level)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateUp(state) {
  // For now, implement as previous sibling
  return navigatePrevious(state);
}

/**
 * Navigate down (vertical navigation maintaining level)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateDown(state) {
  // For now, implement as next sibling
  return navigateNext(state);
}

/**
 * Editing Functions
 */

/**
 * Delete the currently selected expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with deleted content and updated selection
 */
export function deleteExpression(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  // Delete the current node
  const changes = { from: currentNode.from, to: currentNode.to, insert: '' };
  
  // Determine new selection position after deletion
  let newSelection;
  if (currentNode.nextSibling) {
    // Select next sibling
    const next = currentNode.nextSibling;
    newSelection = EditorSelection.single(currentNode.from, currentNode.from + (next.to - next.from));
  } else if (currentNode.prevSibling) {
    // Select previous sibling
    const prev = currentNode.prevSibling;
    newSelection = EditorSelection.single(prev.from, prev.to);
  } else if (currentNode.parent) {
    // Select parent if no siblings
    const parent = currentNode.parent;
    newSelection = EditorSelection.single(parent.from, parent.to);
  } else {
    // Default to beginning
    newSelection = EditorSelection.single(0);
  }
  
  return state.update({
    changes,
    selection: newSelection
  }).state;
}

/**
 * Cut the currently selected expression to clipboard
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with cut content removed and clipboard updated
 */
export function cutExpression(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  // Store in clipboard
  clipboardContent = getNodeText(state, currentNode);
  
  // Delete the content
  return deleteExpression(state);
}

/**
 * Paste clipboard content at current position
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with pasted content
 */
export function pasteExpression(state) {
  if (!clipboardContent) return state;
  
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  // Insert after current node
  const insertPos = currentNode.to;
  const changes = { from: insertPos, to: insertPos, insert: ' ' + clipboardContent };
  
  return state.update({
    changes,
    selection: EditorSelection.single(insertPos + 1, insertPos + 1 + clipboardContent.length)
  }).state;
}

/**
 * Paste clipboard content before current position
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with pasted content
 */
export function pasteExpressionBefore(state) {
  if (!clipboardContent) return state;
  
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode) return state;
  
  // Insert before current node
  const insertPos = currentNode.from;
  const changes = { from: insertPos, to: insertPos, insert: clipboardContent + ' ' };
  
  return state.update({
    changes,
    selection: EditorSelection.single(insertPos, insertPos + clipboardContent.length)
  }).state;
}

/**
 * Helper function to check if a node is a container (list, vector, etc.)
 * @param {SyntaxNode} node - Node to check
 * @returns {boolean} - True if container
 */
function isContainerNode(node) {
  const containerTypes = ['List', 'Vector', 'Map', 'Set'];
  return containerTypes.includes(node.type.name);
}

/**
 * Slurp right - absorb next sibling into current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with slurped content
 */
export function slurpRight(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode || !isContainerNode(currentNode) || !currentNode.nextSibling) {
    return state; // Can't slurp
  }
  
  const nextSibling = currentNode.nextSibling;
  const nextText = getNodeText(state, nextSibling);
  
  // Find the closing bracket/paren position
  const closingPos = currentNode.to - 1; // Assume closing bracket is at end
  const changes = [
    { from: closingPos, to: closingPos, insert: ' ' + nextText },
    { from: nextSibling.from, to: nextSibling.to, insert: '' }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from, currentNode.to + nextText.length + 1)
  }).state;
}

/**
 * Slurp left - absorb previous sibling into current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with slurped content
 */
export function slurpLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode || !isContainerNode(currentNode) || !currentNode.prevSibling) {
    return state; // Can't slurp
  }
  
  const prevSibling = currentNode.prevSibling;
  const prevText = getNodeText(state, prevSibling);
  
  // Find the opening bracket/paren position
  const openingPos = currentNode.from + 1; // Assume opening bracket is at start
  const changes = [
    { from: openingPos, to: openingPos, insert: prevText + ' ' },
    { from: prevSibling.from, to: prevSibling.to, insert: '' }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from - prevText.length - 1, currentNode.to)
  }).state;
}

/**
 * Barf right - expel last element from current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with barfed content
 */
export function barfRight(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode || !isContainerNode(currentNode) || !currentNode.lastChild) {
    return state; // Can't barf
  }
  
  const lastChild = currentNode.lastChild;
  const lastText = getNodeText(state, lastChild);
  
  // Move last child outside the expression
  const closingPos = currentNode.to;
  const changes = [
    { from: lastChild.from, to: lastChild.to, insert: '' },
    { from: closingPos, to: closingPos, insert: ' ' + lastText }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from, currentNode.to - lastText.length - 1)
  }).state;
}

/**
 * Barf left - expel first element from current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with barfed content
 */
export function barfLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from);
  
  if (!currentNode || !isContainerNode(currentNode) || !currentNode.firstChild) {
    return state; // Can't barf
  }
  
  const firstChild = currentNode.firstChild;
  const firstText = getNodeText(state, firstChild);
  
  // Move first child outside the expression
  const openingPos = currentNode.from;
  const changes = [
    { from: firstChild.from, to: firstChild.to, insert: '' },
    { from: openingPos, to: openingPos, insert: firstText + ' ' }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from + firstText.length + 1, currentNode.to)
  }).state;
}

/**
 * Simple placeholder implementations for move operations
 * These would need more sophisticated implementation for full functionality
 */

export function moveNext(state) {
  // Placeholder: swap with next sibling
  return state;
}

export function movePrevious(state) {
  // Placeholder: swap with previous sibling
  return state;
}

export function moveRight(state) {
  // Placeholder: move spatially right
  return state;
}

export function moveLeft(state) {
  // Placeholder: move spatially left
  return state;
}

export function moveUp(state) {
  // Placeholder: move up maintaining level
  return state;
}

export function moveDown(state) {
  // Placeholder: move down maintaining level
  return state;
}

/**
 * Insert operations - placeholders for now
 */

export function insertSymbol(state, symbol) {
  // Placeholder: insert symbol at current position
  return state;
}

export function applyInsert(state, symbol) {
  // Placeholder: insert after current position
  return state;
}

export function applyInsertPre(state, symbol) {
  // Placeholder: insert before current position
  return state;
}

/**
 * Type text at current position
 * @param {EditorState} state - Editor state
 * @param {string} text - Text to type
 * @returns {EditorState} - New state with typed text
 */
export function typeText(state, text) {
  const selection = state.selection.main;
  
  return state.update({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: EditorSelection.single(selection.from + text.length)
  }).state;
}

/**
 * Test helper function to set selection by text content
 * @param {EditorState} state - Editor state
 * @param {string} text - Text to select
 * @returns {EditorState} - New state with updated selection
 */
export function selectByText(state, text) {
  const node = findNodeByText(state, text);
  if (!node) {
    console.warn(`Could not find text "${text}" in document`);
    return state;
  }
  
  return state.update({
    selection: EditorSelection.single(node.from, node.to)
  }).state;
}