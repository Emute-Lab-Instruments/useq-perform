import { StateField, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, Decoration } from "@codemirror/view";


///// DECORATIONS

// Create decoration for highlighting evaluated code
const highlightDecoration = Decoration.mark({
    attributes: { class: "cm-evaluated-code" }
});

// Create decoration for highlighting the current node
const currentNodeDecoration = Decoration.mark({
    attributes: { class: "cm-current-node" }
});

// Create decoration for highlighting the parent node
const parentNodeDecoration = Decoration.mark({
    attributes: { class: "cm-parent-node" }
});

// New: Decorations for left and right siblings (underscore, blue/red)
const leftSiblingDecoration = Decoration.mark({
    attributes: { class: "cm-left-sibling-underscore" }
});
const rightSiblingDecoration = Decoration.mark({
    attributes: { class: "cm-right-sibling-underscore" }
});


///// STATE FIELDS

// Helper function for debug printing
function debug_print(label, obj) {
    if (obj && typeof obj === 'object') {
        if ('type' in obj && 'from' in obj && 'to' in obj) {
            console.log(`${label}:`, {
                type: obj.type.name,
                from: obj.from,
                to: obj.to,
                text: obj.state?.doc.sliceString(obj.from, obj.to)
            });
        } else if ('type' in obj && 'length' in obj && 'children' in obj) {
            console.log(`${label}:`, {
                type: obj.type.name,
                length: obj.length,
                childCount: obj.children.length
            });
        } else {
            console.log(`${label}:`, obj);
        }
    } else {
        console.log(`${label}:`, obj);
    }
}

// Effect for setting the current node
export const setCurrentNodeEffect = StateEffect.define();

// State field to track the current node
const currentNode = StateField.define({
    create(state) {
        // Initialize with the node at the current cursor position
        if (state && state.selection) {
            const tree = syntaxTree(state);
            const root = tree.topNode;
            const pos = state.selection.main.head;
            return findNodeAtPosition(root, pos, state);
        }
        return null;
    },
    update(value, tr) {
        // Handle navigation effect
        for (let e of tr.effects) {
            if (e.is(setCurrentNodeEffect)) {
                debug_print("Current node", e.value);
                return e.value;
            }
        }
        if (tr.selection) {
            const tree = syntaxTree(tr.state);
            const root = tree.topNode;
            const pos = tr.selection.main.head;
            return findNodeAtPosition(root, pos, tr.state);
        }
        debug_print("Current node", value);
        return value;
    }
});

// Helper function to find the appropriate node at a position
function findNodeAtPosition(root, pos, _state) {
    // Collect all nodes at the cursor position
    const nodesAtPos = collectNodesAtPosition(root, pos);

    // Find the most appropriate node based on the cursor position
    return findAppropriateNode(nodesAtPos, pos);
}

/**
 * Collects all nodes that contain the given position
 * @param {SyntaxNode} root - The root node of the syntax tree
 * @param {number} pos - The cursor position
 * @returns {Array} - Array of node information objects
 */
function collectNodesAtPosition(root, pos) {
    const nodes = [];
    const cursor = root.cursor();

    // First pass: collect all nodes that contain the position
    while (cursor.next()) {
        if (cursor.from <= pos && cursor.to >= pos) {
            nodes.push({
                type: cursor.type.name,
                from: cursor.from,
                to: cursor.to,
                size: cursor.to - cursor.from,
                exactStart: cursor.from === pos,
                exactEnd: cursor.to === pos,
                containsPos: true,
                node: cursor.node
            });
        }
    }

    // Sort nodes by size (smallest/most specific first)
    return nodes.sort((a, b) => a.size - b.size);
}

/**
 * Creates a structured node object with parent information
 * @param {Object} nodeInfo - Node information
 * @param {Object} parentInfo - Parent node information (optional)
 * @returns {Object} - Structured node object
 */
function createStructuredNode(nodeInfo, parentInfo = null) {
    const node = {
        type: { name: nodeInfo.type },
        from: nodeInfo.from,
        to: nodeInfo.to
    };

    if (parentInfo) {
        node.parent = {
            type: { name: parentInfo.type },
            from: parentInfo.from,
            to: parentInfo.to
        };
    }

    return node;
}

/**
 * Finds the most appropriate node based on cursor position and node types
 * @param {Array} nodes - Array of node information objects
 * @param {number} pos - The cursor position
 * @returns {Object} - The selected node with parent information
 */
function findAppropriateNode(nodes, pos) {
    if (nodes.length === 0) return null;
    const nodesByType = groupNodesByType(nodes);

    // Special case: if cursor is at the end of a List/Vector, prefer the largest List/Vector node ending at this position
    const endNode = findLargestNodeEndingAt(nodes, pos, ["List", "Vector"]);
    if (endNode) {
        const parent = findImmediateParent(nodes, endNode, ["List", "Vector"]);
        return createStructuredNode(endNode, parent);
    }

    // Priority 1: Handle cursor at the beginning of a list or vector
    const listAtCursor = findNodeExactlyAtPosition(nodes, pos, ["List"]);
    if (listAtCursor) {
        const parent = findImmediateParent(nodes, listAtCursor, ["List"]);
        return createStructuredNode(listAtCursor, parent);
    }
    const vectorAtCursor = findNodeExactlyAtPosition(nodes, pos, ["Vector"]);
    if (vectorAtCursor) {
        const parent = findImmediateParent(nodes, vectorAtCursor, ["List"]);
        return createStructuredNode(vectorAtCursor, parent);
    }

    // Priority 2: Handle symbols
    const symbolNodes = nodesByType["Symbol"] || [];
    for (const symbol of symbolNodes) {
        if (isPositionWithinNode(pos, symbol)) {
            const parent = findImmediateParent(nodes, symbol, ["List", "Vector"]);
            return createStructuredNode(symbol, parent);
        }
    }
    // Priority 3: Handle numbers
    const numberNodes = nodesByType["Number"] || [];
    for (const number of numberNodes) {
        if (isPositionWithinNode(pos, number)) {
            const parent = findImmediateParent(nodes, number, ["List"]);
            return createStructuredNode(number, parent);
        }
    }
    // Priority 4: Handle vectors (when cursor is inside)
    const vectorNodes = nodesByType["Vector"] || [];
    for (const vector of vectorNodes) {
        if (isPositionWithinNode(pos, vector)) {
            const parent = findImmediateParent(nodes, vector, ["List"]);
            return createStructuredNode(vector, parent);
        }
    }
    // Priority 5: Handle lists (when cursor is inside)
    const listNodes = nodesByType["List"] || [];
    for (const list of listNodes) {
        if (isPositionWithinNode(pos, list)) {
            const parent = findImmediateParent(nodes, list, ["List"]);
            return createStructuredNode(list, parent);
        }
    }
    // Fallback: use the smallest/most specific node
    const smallestNode = nodes[0];
    const parent = findImmediateParent(nodes, smallestNode, ["List", "Vector"]);
    return createStructuredNode(smallestNode, parent);
}

function findLargestNodeEndingAt(nodes, pos, types) {
    return nodes
        .filter(node => types.includes(node.type) && node.to === pos)
        .sort((a, b) => b.size - a.size)[0] || null;
}

/**
 * Groups nodes by their type for easier access
 * @param {Array} nodes - Array of node information objects
 * @returns {Object} - Object with node types as keys and arrays of nodes as values
 */
function groupNodesByType(nodes) {
    return nodes.reduce((groups, node) => {
        if (!groups[node.type]) {
            groups[node.type] = [];
        }
        groups[node.type].push(node);
        return groups;
    }, {});
}

/**
 * Finds a node of the specified type that starts exactly at the given position
 * @param {Array} nodes - Array of node information objects
 * @param {number} pos - The cursor position
 * @param {Array} types - Array of node types to look for
 * @returns {Object|null} - The found node or null
 */
function findNodeExactlyAtPosition(nodes, pos, types) {
    return nodes.find(node =>
        types.includes(node.type) &&
        node.from === pos
    );
}

/**
 * Checks if a position is within a node (including at its boundaries)
 * @param {number} pos - The cursor position
 * @param {Object} node - Node information
 * @returns {boolean} - True if the position is within the node
 */
function isPositionWithinNode(pos, node) {
    return pos >= node.from && pos <= node.to;
}

/**
 * Finds the immediate parent of a node from the given types
 * @param {Array} nodes - Array of node information objects
 * @param {Object} childNode - Child node information
 * @param {Array} parentTypes - Array of potential parent types
 * @returns {Object|null} - The parent node or null
 */
function findImmediateParent(nodes, childNode, parentTypes) {
    // Filter potential parents by type and containment
    const potentialParents = nodes.filter(node =>
        parentTypes.includes(node.type) &&
        node.from <= childNode.from &&
        node.to >= childNode.to &&
        !(node.from === childNode.from && node.to === childNode.to) // Not the same node
    );

    if (potentialParents.length === 0) return null;

    // Sort by size (smallest first) to find the most immediate parent
    potentialParents.sort((a, b) => a.size - b.size);

    return potentialParents[0];
}

// State field to hold the last evaluated code range
const lastEvaluatedCode = StateField.define({
    create() {
        return { from: 0, to: 0 };
    },
    update(value, _tr) {
        // This will be updated when code is evaluated
        // console.log("Last evaluated code string: ", _tr.state.doc.sliceString(value.from, value.to));
        return value;
    }
});






// Create decoration provider for evaluated code
export const highlightField = StateField.define({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        // Remove old decorations and add new ones based on the current highlight
        decorations = decorations.map(tr.changes);

        const lastEvaluated = tr.state.field(lastEvaluatedCode);
        if (lastEvaluated && lastEvaluated.from < lastEvaluated.to) {
            return Decoration.set([
                highlightDecoration.range(lastEvaluated.from, lastEvaluated.to)
            ]);
        }

        return Decoration.none;
    },
    provide: field => EditorView.decorations.from(field)
});

// Create decoration provider for current node and parent node highlighting
export const nodeHighlightField = StateField.define({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        // Remove old decorations and map through changes
        decorations = decorations.map(tr.changes);

        // Get the current node from state
        const node = tr.state.field(currentNode, false);
        if (!node) return Decoration.none;

        const ranges = [];

        // Collect all ranges
        if (node.parent && node.parent.from < node.parent.to) {
            ranges.push({
                from: node.parent.from,
                to: node.parent.to,
                decoration: parentNodeDecoration
            });
        }

        if (node.from < node.to) {
            ranges.push({
                from: node.from,
                to: node.to,
                decoration: currentNodeDecoration
            });
        }

        // New: Add left (prev) and right (next) sibling underscore decorations
        const leftSibling = getPrevSiblingNode(node);
        if (leftSibling && leftSibling.from < leftSibling.to) {
            ranges.push({
                from: leftSibling.from,
                to: leftSibling.from + 1, // Only the first character
                decoration: leftSiblingDecoration
            });
        }
        const rightSibling = getNextSiblingNode(node);
        if (rightSibling && rightSibling.from < rightSibling.to) {
            ranges.push({
                from: rightSibling.from,
                to: rightSibling.from + 1, // Only the first character
                decoration: rightSiblingDecoration
            });
        }

        // Sort ranges by 'from' position (required by CodeMirror)
        ranges.sort((a, b) => a.from - b.from);

        // Create the decoration set with sorted ranges
        const decorationSet = ranges.map(range =>
            range.decoration.range(range.from, range.to)
        );

        return Decoration.set(decorationSet);
    },
    provide: field => EditorView.decorations.from(field)
});


// --- Navigation helpers ---
export function getParentNode(node) {
    return node && node.parent ? node.parent : null;
}

export function getFirstChildNode(node) {
    return node && node.firstChild ? node.firstChild : null;
}

export function getNextSiblingNode(node) {
    return node && node.nextSibling ? node.nextSibling : null;
}

export function getPrevSiblingNode(node) {
    return node && node.prevSibling ? node.prevSibling : null;
}

// Command creators for navigation (to be dispatched to the editor)
export function setCurrentNode(view, node) {
    view.dispatch({
        effects: setCurrentNodeEffect.of(node)
    });
}

export function navigateCurrentNode(view, direction) {
    const node = view.state.field(currentNode, false);
    let next = null;
    if (!node) return;
    if (direction === 'parent') next = getParentNode(node);
    if (direction === 'firstChild') next = getFirstChildNode(node);
    if (direction === 'nextSibling') next = getNextSiblingNode(node);
    if (direction === 'prevSibling') next = getPrevSiblingNode(node);
    if (next) setCurrentNode(view, next);
}

// Export all extensions
export let structureExtensions = [
    currentNode,
    lastEvaluatedCode,
    nodeHighlightField,
    highlightField
];
