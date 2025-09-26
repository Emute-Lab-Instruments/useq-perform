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
 * Clear the clipboard (for testing)
 */
export function clearClipboard() {
  clipboardContent = null;
}

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
    let matches = [];
    
    tree.iterate({
      enter(node) {
        if (node.from === from && node.to === to) {
          matches.push(node.node);
        }
      }
    });
    
    // If we have multiple matches, prefer List/Vector/Map over Program
    if (matches.length > 1) {
      for (const match of matches) {
        if (match.type.name !== 'Program') {
          return match;
        }
      }
    }
    
    if (matches.length > 0) return matches[0];
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
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  const cursor = currentNode.cursor();
  if (cursor.firstChild()) {
    // Find the first non-structural child
    do {
      if (!isStructuralToken(cursor.node)) {
        return state.update({
          selection: EditorSelection.single(cursor.node.from, cursor.node.to)
        }).state;
      }
    } while (cursor.nextSibling());
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
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
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
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // If current node has children and is a container, enter it
  if (isContainerNode(currentNode)) {
    const cursor = currentNode.cursor();
    if (cursor.firstChild()) {
      // Skip structural tokens
      do {
        if (!isStructuralToken(cursor.node)) {
          return state.update({
            selection: EditorSelection.single(cursor.node.from, cursor.node.to)
          }).state;
        }
      } while (cursor.nextSibling());
    }
  }
  
  // Otherwise, find the next meaningful node spatially
  return findNextSpatialNode(state, currentNode);
}

/**
 * Navigate spatially to the left (entering/exiting expressions)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Find the previous meaningful node spatially
  return findPrevSpatialNode(state, currentNode);
}

/**
 * Find the next node in spatial order (depth-first traversal)
 * @param {EditorState} state - Editor state
 * @param {SyntaxNode} currentNode - Current node
 * @returns {EditorState} - New state with next spatial selection
 */
function findNextSpatialNode(state, currentNode) {
  // Try to go to next sibling first
  const nextSibling = getNextSibling(currentNode);
  if (nextSibling) {
    return state.update({
      selection: EditorSelection.single(nextSibling.from, nextSibling.to)
    }).state;
  }
  
  // If no next sibling, try to exit to parent
  let parent = currentNode.parent;
  while (parent) {
    // Check if parent has a next sibling
    const parentNextSibling = getNextSibling(parent);
    if (parentNextSibling) {
      return state.update({
        selection: EditorSelection.single(parentNextSibling.from, parentNextSibling.to)
      }).state;
    }
    
    // Check if we should select the parent itself (exit behavior)
    if (isContainerNode(parent) && parent.from !== currentNode.from) {
      return state.update({
        selection: EditorSelection.single(parent.from, parent.to)
      }).state;
    }
    
    parent = parent.parent;
  }
  
  // No more spatial nodes, stay where we are
  return state;
}

/**
 * Find the previous node in spatial order (reverse depth-first traversal)
 * @param {EditorState} state - Editor state
 * @param {SyntaxNode} currentNode - Current node
 * @returns {EditorState} - New state with previous spatial selection
 */
function findPrevSpatialNode(state, currentNode) {
  // Try to go to previous sibling first
  const prevSibling = getPrevSibling(currentNode);
  if (prevSibling) {
    return state.update({
      selection: EditorSelection.single(prevSibling.from, prevSibling.to)
    }).state;
  }
  
  // If no previous sibling, try to exit to parent
  let parent = currentNode.parent;
  while (parent) {
    // Check if parent has a previous sibling
    const parentPrevSibling = getPrevSibling(parent);
    if (parentPrevSibling) {
      return state.update({
        selection: EditorSelection.single(parentPrevSibling.from, parentPrevSibling.to)
      }).state;
    }
    
    // Check if we should select the parent itself (exit behavior)
    if (isContainerNode(parent) && parent.from !== currentNode.from) {
      return state.update({
        selection: EditorSelection.single(parent.from, parent.to)
      }).state;
    }
    
    parent = parent.parent;
  }
  
  // No more spatial nodes, stay where we are
  return state;
}

/**
 * Navigate up (vertical navigation maintaining level)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateUp(state) {
  // For simple cases, treat as previous sibling navigation
  // This is a simplification of proper vertical navigation
  return navigatePrevious(state);
}

/**
 * Navigate down (vertical navigation maintaining level)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateDown(state) {
  // For simple cases, treat as next sibling navigation
  // This is a simplification of proper vertical navigation
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
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Store information about siblings for new selection
  const nextSibling = getNextSibling(currentNode);
  const prevSibling = getPrevSibling(currentNode);
  const parent = currentNode.parent;
  
  // Delete the current node content
  const changes = { from: currentNode.from, to: currentNode.to, insert: '' };
  
  // Determine new selection position after deletion
  let newSelection;
  if (nextSibling) {
    // Select next sibling, adjusting for deleted content
    const offset = currentNode.to - currentNode.from;
    newSelection = EditorSelection.single(nextSibling.from - offset, nextSibling.to - offset);
  } else if (prevSibling) {
    // Select previous sibling (position unchanged)
    newSelection = EditorSelection.single(prevSibling.from, prevSibling.to);
  } else if (parent && isContainerNode(parent)) {
    // Select parent if no siblings (empty container case)
    const offset = currentNode.to - currentNode.from;
    newSelection = EditorSelection.single(parent.from, parent.to - offset);
  } else {
    // Default to beginning of document
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
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Store in clipboard
  clipboardContent = getNodeText(state, currentNode);
  
  // Delete the content (use same logic as deleteExpression)
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
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
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
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
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
  const containerTypes = ['List', 'Vector', 'Map', 'Set', 'Program'];
  return containerTypes.includes(node.type.name);
}

/**
 * Slurp right - absorb next sibling into current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with slurped content
 */
export function slurpRight(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode || !isContainerNode(currentNode)) {
    return state; // Can't slurp non-containers
  }
  
  const nextSibling = getNextSibling(currentNode);
  if (!nextSibling) {
    return state; // Nothing to slurp
  }
  
  const nextText = getNodeText(state, nextSibling);
  
  // Find the position just before the closing bracket
  // We need to be more careful about finding the actual closing position
  let closingPos = currentNode.to - 1;
  while (closingPos > currentNode.from && state.sliceDoc(closingPos, closingPos + 1).match(/\s/)) {
    closingPos--;
  }
  
  const changes = [
    // Insert the next sibling content before the closing bracket
    { from: closingPos, to: closingPos, insert: ' ' + nextText },
    // Remove the original next sibling (with a space if needed)
    { from: nextSibling.from - 1, to: nextSibling.to, insert: '' }
  ];
  
  // Calculate new selection boundaries
  const newTo = currentNode.to + nextText.length;
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from, newTo)
  }).state;
}

/**
 * Slurp left - absorb previous sibling into current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with slurped content
 */
export function slurpLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode || !isContainerNode(currentNode)) {
    return state; // Can't slurp non-containers
  }
  
  const prevSibling = getPrevSibling(currentNode);
  if (!prevSibling) {
    return state; // Nothing to slurp
  }
  
  const prevText = getNodeText(state, prevSibling);
  
  // Find the position just after the opening bracket
  let openingPos = currentNode.from + 1;
  while (openingPos < currentNode.to && state.sliceDoc(openingPos, openingPos + 1).match(/\s/)) {
    openingPos++;
  }
  
  const changes = [
    // Remove the previous sibling (with trailing space if needed)
    { from: prevSibling.from, to: currentNode.from, insert: '' },
    // Insert the previous sibling content after the opening bracket
    { from: openingPos - prevText.length - 1, to: openingPos - prevText.length - 1, insert: prevText + ' ' }
  ];
  
  // Calculate new selection boundaries  
  const newFrom = prevSibling.from;
  const newTo = currentNode.to - 1; // Adjust for removed space
  
  return state.update({
    changes,
    selection: EditorSelection.single(newFrom, newTo)
  }).state;
}

/**
 * Barf right - expel last element from current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with barfed content
 */
export function barfRight(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode || !isContainerNode(currentNode)) {
    return state; // Can't barf non-containers
  }
  
  // Find the last non-structural child
  let lastChild = null;
  const cursor = currentNode.cursor();
  if (cursor.firstChild()) {
    do {
      if (!isStructuralToken(cursor.node)) {
        lastChild = cursor.node;
      }
    } while (cursor.nextSibling());
  }
  
  if (!lastChild) {
    return state; // No children to barf
  }
  
  const lastText = getNodeText(state, lastChild);
  
  // Move last child outside the expression (after the closing bracket)
  const changes = [
    { from: lastChild.from, to: lastChild.to, insert: '' },
    { from: currentNode.to, to: currentNode.to, insert: ' ' + lastText }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from, currentNode.to - lastText.length)
  }).state;
}

/**
 * Barf left - expel first element from current expression
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with barfed content
 */
export function barfLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode || !isContainerNode(currentNode)) {
    return state; // Can't barf non-containers
  }
  
  // Find the first non-structural child
  let firstChild = null;
  const cursor = currentNode.cursor();
  if (cursor.firstChild()) {
    do {
      if (!isStructuralToken(cursor.node)) {
        firstChild = cursor.node;
        break; // Take the first one
      }
    } while (cursor.nextSibling());
  }
  
  if (!firstChild) {
    return state; // No children to barf
  }
  
  const firstText = getNodeText(state, firstChild);
  
  // Move first child outside the expression (before the opening bracket)
  const changes = [
    { from: firstChild.from, to: firstChild.to, insert: '' },
    { from: currentNode.from, to: currentNode.from, insert: firstText + ' ' }
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

/**
 * Move operations - swap elements with siblings
 */

export function moveNext(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  const nextSibling = getNextSibling(currentNode);
  if (!nextSibling) return state; // Can't move if no next sibling
  
  const currentText = getNodeText(state, currentNode);
  const nextText = getNodeText(state, nextSibling);
  
  // Swap the two elements
  const changes = [
    { from: currentNode.from, to: currentNode.to, insert: nextText },
    { from: nextSibling.from, to: nextSibling.to, insert: currentText }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(nextSibling.from, nextSibling.from + currentText.length)
  }).state;
}

export function movePrevious(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  const prevSibling = getPrevSibling(currentNode);
  if (!prevSibling) return state; // Can't move if no previous sibling
  
  const currentText = getNodeText(state, currentNode);
  const prevText = getNodeText(state, prevSibling);
  
  // Swap the two elements
  const changes = [
    { from: prevSibling.from, to: prevSibling.to, insert: currentText },
    { from: currentNode.from, to: currentNode.to, insert: prevText }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(prevSibling.from, prevSibling.from + currentText.length)
  }).state;
}

export function moveRight(state) {
  // Placeholder: For now, just swap with next sibling as a fallback
  return moveNext(state);
}

export function moveLeft(state) {
  // Placeholder: For now, just swap with previous sibling as a fallback
  return movePrevious(state);
}

export function moveUp(state) {
  // Placeholder: For now, just swap with previous sibling as a fallback
  return movePrevious(state);
}

export function moveDown(state) {
  // Placeholder: For now, just swap with next sibling as a fallback
  return moveNext(state);
}

/**
 * Insert operations
 */

export function insertSymbol(state, symbol) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Insert after current node
  const insertPos = currentNode.to;
  const changes = { from: insertPos, to: insertPos, insert: ' ' + symbol };
  
  return state.update({
    changes,
    selection: EditorSelection.single(insertPos + 1, insertPos + 1 + symbol.length)
  }).state;
}

export function insertSymbolBefore(state, symbol) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Insert before current node
  const insertPos = currentNode.from;
  const changes = { from: insertPos, to: insertPos, insert: symbol + ' ' };
  
  return state.update({
    changes,
    selection: EditorSelection.single(insertPos, insertPos + symbol.length)
  }).state;
}

export function insertFunctionCall(state, symbol) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Insert function call with two placeholders after current node
  const insertPos = currentNode.to;
  const funcCall = ` (${symbol} _ _)`;
  const changes = { from: insertPos, to: insertPos, insert: funcCall };
  
  // Select the first placeholder "_"
  const placeholderPos = insertPos + 2 + symbol.length + 1; // " (" + symbol + " " + "_"
  
  return state.update({
    changes,
    selection: EditorSelection.single(placeholderPos, placeholderPos + 1)
  }).state;
}

export function insertFunctionCallBefore(state, symbol) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Insert function call with placeholder before current node
  const insertPos = currentNode.from;
  const funcCall = `(${symbol} _) `;
  const changes = { from: insertPos, to: insertPos, insert: funcCall };
  
  // Select the placeholder "_"
  const placeholderPos = insertPos + funcCall.indexOf('_');
  
  return state.update({
    changes,
    selection: EditorSelection.single(placeholderPos, placeholderPos + 1)
  }).state;
}

export function wrapInFunction(state, symbol) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  const currentText = getNodeText(state, currentNode);
  const wrappedCall = `(${symbol} ${currentText} _)`;
  
  const changes = { from: currentNode.from, to: currentNode.to, insert: wrappedCall };
  
  // Select the placeholder "_"
  const placeholderPos = currentNode.from + wrappedCall.indexOf('_');
  
  return state.update({
    changes,
    selection: EditorSelection.single(placeholderPos, placeholderPos + 1)
  }).state;
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
    selection: EditorSelection.single(selection.from, selection.from + text.length)
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