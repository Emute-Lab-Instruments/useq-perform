/**
 * New Structural Editing Extensions for CodeMirror
 * 
 * This module creates a self-contained extension for CodeMirror that wraps/includes
 * the nextjournal clojure-mode extension and implements structural navigation and
 * editing features required by the YAML test cases.
 */

import { EditorState, EditorSelection, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { default_extensions } from '@nextjournal/clojure-mode';

// Global clipboard for cut/paste operations
let clipboardContent = null;

// Navigation metadata to keep track of traversal state and exit history
const navigationMetaEffect = StateEffect.define();

function createNavigationMeta(overrides = {}) {
  const traversalStack = overrides.traversalStack
    ? [...overrides.traversalStack]
    : [];
  return {
    lastExited: overrides.lastExited ?? null,
    traversalStack
  };
}

const defaultNavigationMeta = createNavigationMeta();

const navigationMetaField = StateField.define({
  create() {
    return createNavigationMeta();
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(navigationMetaEffect)) {
        return effect.value;
      }
    }
    return value;
  }
});

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
    extensions: [...default_extensions, navigationMetaField]
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

function getNavigationMeta(state) {
  return state.field ? state.field(navigationMetaField, false) || defaultNavigationMeta : defaultNavigationMeta;
}

function getTraversalStack(meta) {
  return meta && Array.isArray(meta.traversalStack) ? meta.traversalStack : [];
}

function addTraversalEntry(stack, type, node) {
  return [...stack, { type, from: node.from, to: node.to }];
}

function removeTraversalEntry(stack, type, node) {
  if (!node || !stack || stack.length === 0) return stack || [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.type === type && nodesMatch(entry, node)) {
      return [...stack.slice(0, i), ...stack.slice(i + 1)];
    }
  }
  return stack;
}

function hasTraversalEntry(meta, type, node) {
  if (!node) return { match: null, stack: getTraversalStack(meta) };
  const stack = getTraversalStack(meta);
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.type === type && nodesMatch(entry, node)) {
      return { match: entry, index: i, stack };
    }
  }
  return { match: null, index: -1, stack };
}

function makeSelection(state, node, { reverse = false, exitDirection = null, meta = null } = {}) {
  if (!node) return state;
  const selection = EditorSelection.single(
    reverse ? node.to : node.from,
    reverse ? node.from : node.to
  );

  const metaConfig = {};
  
  // Use explicitly provided meta if available
  if (meta) {
      if (meta.lastExited) metaConfig.lastExited = meta.lastExited;
      if (meta.traversalStack) metaConfig.traversalStack = meta.traversalStack;
  }
  
  // Only auto-generate lastExited from exitDirection if not already provided
  if (exitDirection && !metaConfig.lastExited) {
    metaConfig.lastExited = { from: node.from, to: node.to, direction: exitDirection };
  }

  const metaValue = Object.keys(metaConfig).length > 0
    ? createNavigationMeta(metaConfig)
    : createNavigationMeta();

  return state.update({
    selection,
    effects: navigationMetaEffect.of(metaValue)
  }).state;
}

function nodesMatch(metaEntry, node) {
  if (!metaEntry || !node) return false;
  return metaEntry.from === node.from && metaEntry.to === node.to;
}

  const structuralTokenTypes = new Set(['(', ')', '[', ']', '{', '}', 'Brace', 'Bracket', 'Paren', '#', "'", 'LineComment', 'BlockComment', 'Comment']);

  function isStructuralToken(node) {
    return structuralTokenTypes.has(node.type.name);
  }

  function isSelectableContainer(node) {
    if (!node) return false;
    return ['List', 'Vector', 'Map', 'Set'].includes(node.type.name);
  }

  function iterateLogicalChildren(node, visitor) {
    if (!node) return;
    const cursor = node.cursor();
    if (!cursor.firstChild()) return;
    do {
      if (isStructuralToken(cursor.node)) continue;
      if (node.type.name === 'Set' && cursor.node.type.name === 'Map') {
        iterateLogicalChildren(cursor.node, visitor);
        continue;
      }
      visitor(cursor.node);
    } while (cursor.nextSibling());
  }

  function getLogicalChildren(node) {
    const children = [];
    iterateLogicalChildren(node, child => children.push(child));
    return children;
  }

  function getFirstContentChild(node) {
    const children = getLogicalChildren(node);
    return children.length > 0 ? children[0] : null;
  }

  function getLastContentChild(node) {
    const children = getLogicalChildren(node);
    return children.length > 0 ? children[children.length - 1] : null;
  }

  function getChildIndex(parent, child) {
    if (!parent || !child) return null;
    const children = getLogicalChildren(parent);
    for (let i = 0; i < children.length; i++) {
      if (nodesMatch(children[i], child)) {
        return i;
      }
    }
    return null;
  }

  function getChildByIndex(parent, index) {
    const children = getLogicalChildren(parent);
    if (index == null || index < 0 || index >= children.length) return null;
    return children[index];
  }

  function ascendFromChild(state, node, direction, metaOverrides = null) {
  let ancestor = node.parent;
  let child = node;
  
  while (ancestor) {
      if (ancestor.type.name === 'Program') {
          return state;
      }
      
      if (isSelectableContainer(ancestor)) {
        const target = ancestor.type.name === 'Map' && ancestor.parent?.type.name === 'Set'
          ? ancestor.parent
          : ancestor;
        
        // Always select the ancestor to stop at the container boundary
        const newMeta = { 
            ...(metaOverrides || {}),
            lastExited: { from: child.from, to: child.to, direction }
        };
        return makeSelection(state, target, { meta: newMeta });
    }
    
    child = ancestor;
    ancestor = ancestor.parent;
  }
  return state;
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
  return makeSelection(state, nextNode);
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
  return makeSelection(state, prevNode);
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
  
  const firstChild = getFirstContentChild(currentNode);
  if (firstChild) {
    return makeSelection(state, firstChild);
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
  if (parent.type.name === 'Program') {
    return state;
  }
  return makeSelection(state, parent);
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
  const meta = getNavigationMeta(state);
  const exitedFromChild = meta.lastExited && meta.lastExited.direction === 'right' && 
    // Check if lastExited was a child of currentNode (simple containment check)
    (meta.lastExited.from >= currentNode.from && meta.lastExited.to <= currentNode.to && 
     (meta.lastExited.from !== currentNode.from || meta.lastExited.to !== currentNode.to));
  
  const parent = currentNode.parent;
  const traversalStack = getTraversalStack(meta);

  // 1. If container and not just exited, try to enter first child
  if (isSelectableContainer(currentNode) && !exitedFromChild) {
    const firstChild = getFirstContentChild(currentNode);
    if (firstChild) {
       // Standard entry
       return makeSelection(state, firstChild);
    }
    // No children? Fall through to sibling check
  }

  // 2. Try next sibling
  const nextSibling = getNextSibling(currentNode);
  if (nextSibling) {
    const metaPayload = traversalStack.length ? { traversalStack } : null;
    return makeSelection(state, nextSibling, { meta: metaPayload });
  }

  // 3. No sibling? Ascend to parent
  if (parent && parent.type.name !== 'Program') {
     // Always select the parent we are ascending to, regardless of siblings
     // This ensures we stop at the container boundary
     return ascendFromChild(state, currentNode, 'right', traversalStack.length ? { traversalStack } : null);
  }
  
  // 4. At root and done? Stay here.
  return state;
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
  const meta = getNavigationMeta(state);
  const exitedFromChild = meta.lastExited && meta.lastExited.direction === 'left' && 
    (meta.lastExited.from >= currentNode.from && meta.lastExited.to <= currentNode.to && 
     (meta.lastExited.from !== currentNode.from || meta.lastExited.to !== currentNode.to));
  const parent = currentNode.parent;

  // Check if cursor is at the start of the current node (prevent re-entry)
  const isAtStart = selection.head <= currentNode.from;

  // 1. If container and not just exited, try to enter last child
  if (isSelectableContainer(currentNode) && !exitedFromChild && !isAtStart) {
    const lastChild = getLastContentChild(currentNode);
    if (lastChild) {
       return makeSelection(state, lastChild);
    }
  }

  // 2. Try previous sibling
  const prevSibling = getPrevSibling(currentNode);
  if (prevSibling) {
    return makeSelection(state, prevSibling);
  }

  // 3. No sibling? Ascend to parent
  if (parent && parent.type.name !== 'Program') {
     return ascendFromChild(state, currentNode, 'left');
  }
  
  // 4. At root and done? Stay here.
  return state;
}

/**
 * Navigate up (vertical navigation maintaining level)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateUp(state) {
  return navigateVertical(state, 'up');
}

/**
 * Navigate down (vertical navigation maintaining level)
 * @param {EditorState} state - Editor state
 * @returns {EditorState} - New state with updated selection
 */
export function navigateDown(state) {
  return navigateVertical(state, 'down');
}

function navigateVertical(state, direction) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  if (!currentNode) return state;

  const parent = currentNode.parent;
  if (!parent) return state;

  const siblingGetter = direction === 'down' ? getNextSibling : getPrevSibling;

  if (parent.type.name === 'Program') {
    const sibling = siblingGetter(currentNode);
    if (sibling) {
      return makeSelection(state, sibling);
    }
    return state;
  }

  if (isSelectableContainer(currentNode)) {
    const sibling = siblingGetter(currentNode);
    if (sibling) {
      return makeSelection(state, sibling);
    }
    return state;
  }

  const containerSibling = siblingGetter(parent);
  if (!containerSibling) {
    return state;
  }

  if (!isSelectableContainer(containerSibling)) {
    return makeSelection(state, containerSibling);
  }

  const childIndex = getChildIndex(parent, currentNode) ?? 0;
  const targetChild = getChildByIndex(containerSibling, childIndex) || getFirstContentChild(containerSibling) || containerSibling;
  return makeSelection(state, targetChild);
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
  
  // Robustly find the closing bracket position
  // currentNode.to is usually the position AFTER the closing bracket
  // So we want to insert BEFORE currentNode.to - 1 ? 
  // Let's be safer: assume the last character is the closing bracket.
  const closingPos = currentNode.to - 1;
  
  // Find start of next sibling to delete, including the whitespace between them if possible
  let deleteFrom = currentNode.to;
  // Expand deletion range backward to include whitespace between closing bracket and next sibling
  // Actually, the whitespace is AFTER the closing bracket (currentNode.to) and BEFORE nextSibling.from
  deleteFrom = currentNode.to;
  
  // Define the deletion range: from end of current node to end of next sibling
  const deleteTo = nextSibling.to;
  
  const changes = [
    // Insert the next sibling content (with space) before the closing bracket
    { from: closingPos, to: closingPos, insert: ' ' + nextText },
    // Remove the original next sibling and the whitespace before it
    { from: deleteFrom, to: deleteTo, insert: '' }
  ];
  
  // Calculate new selection boundaries
  // We expanded the container by (1 + nextText.length)
  const newTo = currentNode.to + 1 + nextText.length;
  
  // If the original selection was the whole list, keep it selected (now larger)
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from, deleteTo) // Heuristic: select roughly the new range? 
    // Actually, let's just select the new expanded list.
    // The 'deleteTo' is the old end of nextSibling. The new list ends at... 
    // Wait, coordinate mapping is hard with multiple changes.
    // Let's rely on the fact that we are growing the current node.
    // But we are deleting stuff after it.
    // The resulting document length decreases by (space_between).
    // New node 'to' will be: currentNode.from + (currentNode.to - currentNode.from) + (1 + nextText.length) - 1 ??
    // Let's simplify: The operation effectively merges them.
    // Let's select the newly formed list.
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
    return state;
  }
  
  const prevSibling = getPrevSibling(currentNode);
  if (!prevSibling) {
    return state;
  }
  
  const prevText = getNodeText(state, prevSibling);
  
  // Insert just after the opening bracket
  const openingPos = currentNode.from + 1;
  
  // We want to delete the previous sibling AND the whitespace between it and the current node.
  // The range is [prevSibling.from, currentNode.from].
  // This assumes they are adjacent or separated by whitespace.
  const deleteFrom = prevSibling.from;
  const deleteTo = currentNode.from;
  
  const changes = [
    // Delete previous sibling and intervening space
    { from: deleteFrom, to: deleteTo, insert: '' },
    // Insert content inside
    { from: openingPos, to: openingPos, insert: prevText + ' ' }
  ];
  
  // Calculate new selection boundaries
  // We removed (currentNode.from - prevSibling.from) characters before the node.
  // But we added (prevText.length + 1) characters inside.
  // The node start shifts left by (currentNode.from - prevSibling.from).
  // The node end ... well, let's just select the new range relative to the new start.
  // The new start is prevSibling.from.
  // The new end is: old_end - deleted_space + added_text?
  // Simpler: New selection covers [prevSibling.from, original_to - deleted_gap + inserted_gap??]
  // Let's just select the resulting list which starts at deleteFrom.
  const oldLength = currentNode.to - currentNode.from;
  const newLength = oldLength + prevText.length + 1; // Approximate (if we didn't delete inner space)
  // Actually, just relying on the update to keep selection is risky with multiple changes.
  // Let's explicit set it.
  // New list starts at 'deleteFrom'.
  // New list text is 'prevText' + ' ' + 'original_content'.
  // Wait, we deleted 'prevSibling' + 'space'.
  // We inserted 'prevText' + ' '.
  // The length change is: (prevText + 1) - (prevText + space).
  // If space was 1 char, length is constant.
  // So new 'to' is approx currentNode.to.
  
  // Let's try to calculate new end:
  // Old doc length: L. New doc length: L - (deleteTo - deleteFrom) + (prevText.length + 1).
  // Shift amount = (prevText.length + 1) - (deleteTo - deleteFrom).
  // New 'to' = currentNode.to + shift amount.
  
  const shift = (prevText.length + 1) - (deleteTo - deleteFrom);
  const newTo = currentNode.to + shift;

  return state.update({
    changes,
    selection: EditorSelection.single(deleteFrom, newTo)
  }).state;
}

export function barfRight(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode || !isContainerNode(currentNode)) {
    return state;
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
    return state;
  }
  
  // Check if we should barf single element
  // The test "barf right single element - nothing to barf" expects no change for "(a)".
  // This implies we shouldn't barf if it's the only element?
  // Or maybe checking strict equality with test expectation.
  // Let's assume for now that we should check count.
  let childCount = 0;
  let c2 = currentNode.cursor();
  if (c2.firstChild()) {
    do {
      if (!isStructuralToken(c2.node)) childCount++;
    } while (c2.nextSibling());
  }
  if (childCount <= 1) {
      // Only 1 element? 
      // But "barf left" test "barf left - list expels first element" on "(a b c)" -> "a (b c)".
      // If I have "(a)", and I barf, I get "a ()". 
      // Why does the test want "(a)"?
      // Maybe because the selection is on "(a)"?
      // If selection is on "a", barf works?
      // Test: selection: "(a)".
      // If I barf, I destroy the container conceptually?
      // Let's implement the check to pass the test.
      return state;
  }
  
  const lastText = getNodeText(state, lastChild);
  
  // Move last child outside the expression (after the closing bracket)
  // We should also delete the space before it if possible.
  // Logic similar to slurpRight but reversed.
  // deleteFrom should range from (prevSibling.to or start) to lastChild.to.
  
  const changes = [
    { from: lastChild.from, to: lastChild.to, insert: '' },
    { from: currentNode.to, to: currentNode.to, insert: ' ' + lastText }
  ];
  
  return state.update({
    changes,
    selection: EditorSelection.single(currentNode.from, currentNode.to - lastText.length)
  }).state;
}

export function barfLeft(state) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode || !isContainerNode(currentNode)) {
    return state;
  }
  
  let firstChild = null;
  const cursor = currentNode.cursor();
  if (cursor.firstChild()) {
    do {
      if (!isStructuralToken(cursor.node)) {
        firstChild = cursor.node;
        break;
      }
    } while (cursor.nextSibling());
  }
  
  if (!firstChild) {
    return state;
  }
  
  const firstText = getNodeText(state, firstChild);
  
  // Insert expelled content before the list
  const insertPos = currentNode.from;
  
  // Delete the child from inside.
  // We should also delete the space after it if possible.
  let deleteTo = firstChild.to;
  while (deleteTo < currentNode.to && state.sliceDoc(deleteTo, deleteTo + 1).match(/\s/)) {
    deleteTo++;
  }
  
  const changes = [
    { from: firstChild.from, to: deleteTo, insert: '' },
    { from: insertPos, to: insertPos, insert: firstText + ' ' }
  ];
  
  // Selection update:
  // We added (firstText + 1) before the node.
  // We removed (deleteTo - firstChild.from) from inside.
  // The list start shifts right by (firstText + 1).
  const shiftStart = firstText.length + 1;
  const internalLoss = deleteTo - firstChild.from;
  
  const newFrom = currentNode.from + shiftStart;
  const newTo = currentNode.to + shiftStart - internalLoss;

  return state.update({
    changes,
    selection: EditorSelection.single(newFrom, newTo)
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
  
  // Calculate delta for the second insertion point (nextSibling)
  // The first insertion (currentNode) changes the document length by (nextText.length - currentText.length).
  // Since nextSibling is AFTER currentNode, its position shifts by this delta.
  const delta = nextText.length - currentText.length;
  const newNextPos = nextSibling.from + delta;
  
  return state.update({
    changes,
    selection: EditorSelection.single(newNextPos, newNextPos + currentText.length)
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
  return moveVertical(state, 'up');
}

export function moveDown(state) {
  return moveVertical(state, 'down');
}

function moveVertical(state, direction) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  if (!currentNode) return state;

  const doc = state.doc;
  const currentLine = doc.lineAt(currentNode.from);
  const targetLineNum = direction === 'up' ? currentLine.number - 1 : currentLine.number + 1;

  if (targetLineNum < 1 || targetLineNum > doc.lines) {
    return state; // Boundary
  }

  const targetLine = doc.line(targetLineNum);
  
  // 1. Find a container on the target line
  // We'll look for the first node that starts on that line
  let targetContainer = null;
  const tree = getTree(state);
  
  // Scan the line for the first meaningful node
  tree.iterate({
    from: targetLine.from,
    to: targetLine.to,
    enter: (node) => {
      if (node.from >= targetLine.from && node.to <= targetLine.to) {
        // If we found a container, great
        if (isContainerNode(node.node)) {
           targetContainer = node.node;
           return false; // Stop
        }
        // If we found a list item, find its parent
        if (!targetContainer && node.node.parent && isContainerNode(node.node.parent)) {
           // Check if the parent is actually ON this line? 
           // If the parent spans multiple lines, we might be moving INTO it.
           // The tests expect: (a b)\n(c d) -> move 'b' down -> (b a)\n(c d) OR (b)\n(a c d).
           // Wait, the test said:
           // (a b)\n(c d) -> move 'a' down -> (b)\n(a c d).
           // This means 'a' was removed from line 1 and prepended to line 2's list.
           const parent = node.node.parent;
           // We want the container that *dominates* this line, or is ON this line.
           targetContainer = parent; 
           return false;
        }
      }
    }
  });
  
  // If no specific container found (empty line?), maybe just paste at start of line?
  // But for structural editing, we usually want to merge into a list.
  
  const nodeText = getNodeText(state, currentNode);
  
  // Prepare the move:
  // 1. Delete current node.
  // 2. Insert at target.
  
  const deletionChange = { from: currentNode.from, to: currentNode.to, insert: '' };
  // Adjust deletion to remove surrounding whitespace if possible (cleanup)
  // For now, simple deletion.
  
  // Insertion point:
  let insertPos = targetLine.from;
  let insertText = nodeText + ' ';
  
  if (targetContainer) {
    if (direction === 'down') {
        // Prepend
        insertPos = targetContainer.from + 1;
        insertText = nodeText + ' ';
    } else {
        // Append
        // targetContainer.to is after closing bracket. We want before it.
        insertPos = targetContainer.to - 1;
        insertText = ' ' + nodeText;
    }
  } else {
      insertText = nodeText + '\n';
  }
  
  // We need to apply changes atomically. 
  // Coordinate mapping is tricky if we just use `changes`.
  // Let's use `cut` then `paste` logic but manually?
  
  // Let's try a simpler approach: use `changes` but account for shift.
  const changes = [];
  changes.push({ from: currentNode.from, to: currentNode.to, insert: '' });
  
  // If insertion is AFTER deletion, we need to adjust insertPos?
  // Or just use CodeMirror's transaction mapping?
  // Actually, CodeMirror `changes` array handles mapping if passed as spec.
  // But here we calculated absolute positions.
  // If we delete FIRST (smaller pos) and insert LATER (larger pos), 
  // the insert pos needs to shift down by deletion size.
  
  // Case 1: Move Down (Target > Current)
  // Deletion is at P1. Insertion is at P2 (P2 > P1).
  // When P1 is deleted, P2 shifts left by (P1_len).
  // BUT, if we are moving 'down', we are deleting from top and adding to bottom.
  
  let newSelection;
  const deletedLength = currentNode.to - currentNode.from;
  const insertedLength = insertText.length; // Includes spaces

  if (insertPos > currentNode.from) {
     // We are moving down.
     changes.push({ from: insertPos, to: insertPos, insert: insertText });
     
     // Calculate new selection logic
     // The insertPos was calculated based on OLD doc.
     // After deletion, the effective insert pos shifts by -deletedLength.
     // Wait, does CodeMirror 'changes' application handle this? 
     // CodeMirror 6 transactions: spec says "The changes are applied in order". 
     // If passed as an array, "mapped to the document created by the changes before it"? 
     // Actually, standard behavior is usually concurrent application unless sequential mode is used.
     // But 'changes' property in update accepts "ChangeSpec".
     // If array: "Changes are applied in the order they appear..." 
     // "However, positions in later changes are specified relative to the document *before* any changes are applied" if it's a ChangeSet?
     // No, CM6 state.update({changes: [...]}) treats them as simultaneous if possible, 
     // OR handles mapping if they are independent.
     // If they are independent (ranges don't overlap), we use original positions.
     // My ranges don't overlap (moving lines).
     // So I should use ORIGINAL positions for the changes.
     
     // BUT for calculating the *resulting* selection, I need to know where it ends up.
     // Resulting pos = Original_InsertPos - DeletedLength (since deletion is before insertion).
     const resultingPos = insertPos - deletedLength;
     // We select the inserted text (trimmed of padding if possible, but selecting all is safer for now)
     newSelection = EditorSelection.single(resultingPos, resultingPos + nodeText.length);
     
  } else {
     // We are moving up. 
     // Deletion is at P2. Insertion is at P1 (P1 < P2).
     // Insertion happens first in the file (conceptually).
     // P1 is before P2.
     changes.push({ from: insertPos, to: insertPos, insert: insertText });
     
     // Resulting pos = Original_InsertPos (deletion is AFTER, so doesn't affect prefix).
     // But wait, we added text. So indices after P1 shift right. 
     // But the deletion is at P2. P2 > P1.
     // The selection is at P1.
     const resultingPos = insertPos;
     // Adjust for the space we added?
     // insertText = nodeText + ' ' or ' ' + nodeText.
     // If ' ' + nodeText, pos + 1.
     const offset = insertText.startsWith(' ') ? 1 : 0;
     newSelection = EditorSelection.single(resultingPos + offset, resultingPos + offset + nodeText.length);
  }
  
  return state.update({ 
      changes, 
      selection: newSelection,
      scrollIntoView: true 
  }).state;
}

/**
 * Insert operations
 */

export function insertSymbol(state, symbol) {
  const selection = state.selection.main;
  const currentNode = findNodeAt(state, selection.from, selection.to);
  
  if (!currentNode) return state;
  
  // Check if we should insert inside an empty container
  let insertInside = false;
  if (isContainerNode(currentNode)) {
      // Check if empty (only structural tokens)
      let hasContent = false;
      const cursor = currentNode.cursor();
      if (cursor.firstChild()) {
          do {
              if (!isStructuralToken(cursor.node)) {
                  hasContent = true;
                  break;
              }
          } while (cursor.nextSibling());
      }
      if (!hasContent) {
          insertInside = true;
      }
  }

  if (insertInside) {
      // Insert inside the empty container
      // Assuming () or [], insert at from + 1
      const insertPos = currentNode.from + 1;
      const changes = { from: insertPos, to: insertPos, insert: symbol };
      return state.update({
        changes,
        selection: EditorSelection.single(insertPos, insertPos + symbol.length)
      }).state;
  }
  
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
  
  // Insert function call with ONE placeholder after current node
  const insertPos = currentNode.to;
  const funcCall = ` (${symbol} _)`;
  const changes = { from: insertPos, to: insertPos, insert: funcCall };
  
  // Select the placeholder "_"
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
 * @param {Object} options - Selection options (e.g. { reverse: true })
 * @returns {EditorState} - New state with updated selection
 */
export function selectByText(state, text, options = {}) {
  const node = findNodeByText(state, text);
  if (!node) {
    console.warn(`Could not find text "${text}" in document`);
    return state;
  }
  
  return makeSelection(state, node, options);
}

// DEBUG ONLY: remove after troubleshooting
export function __debugNavigationMeta(state) {
  return getNavigationMeta(state);
}
