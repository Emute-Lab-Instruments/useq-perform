import { StateField, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, Decoration } from "@codemirror/view";
import { dbg } from "../../utils.mjs";

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

// Effect for setting the current node
export const setCurrentNodeEffect = StateEffect.define();

function cleanupParent(parent, state) {
    if (!parent) return null;
    if (parent.name === "Operator") {
        // Skip operator nodes and return their parent instead
        return parent.parent ? cleanupNode(parent.parent, state) : null;
    }
    return cleanupNode(parent, state);
}

// Helper function to determine if a node is a bracket or paren
function isBracketOrParen(nodeName) {
    return nodeName === '[' || nodeName === ']' ||
           nodeName === '(' || nodeName === ')' ||
           nodeName === '{' || nodeName === '}';
}

// Helper function to determine if a node is a container (List, Vector, Map)
function isContainer(nodeName) {
    return nodeName === 'List' || nodeName === 'Vector' || nodeName === 'Map';
}

// Helper function to get the container type based on brackets
function getContainerType(openBracket) {
    if (openBracket === '[') return 'Vector';
    if (openBracket === '(') return 'List';
    if (openBracket === '{') return 'Map';
    return null;
}

function cleanupNode(node, state) {
    if (!node) return null;

    // Extract the node's text content
    const text = state.sliceDoc(node.from, node.to);

    // If we're on a bracket or paren, get the parent container instead
    if (isBracketOrParen(node.name) && node.parent) {
        // We're on a bracket, so get the parent container
        return cleanupNode(node.parent, state);
    }

    // If we're on an operator, get the parent container
    if (node.name === 'Operator' && node.parent) {
        return cleanupNode(node.parent, state);
    }

    // Determine the node type based on its name and content
    let nodeType = node.name;

    // Handle special cases for Clojure syntax
    if (nodeType === 'Number' || nodeType === 'String' || nodeType === 'Symbol') {
        // These are already correct
    } else if (text.startsWith('[') && text.endsWith(']')) {
        nodeType = 'Vector';
    } else if (text.startsWith('(') && text.endsWith(')')) {
        nodeType = 'List';
    } else if (text.startsWith('{') && text.endsWith('}')) {
        nodeType = 'Map';
    } else if (/^[a-zA-Z0-9_\-+*\/\.!?]+$/.test(text)) {
        nodeType = 'Symbol';
    }

    // Create the node object with all necessary properties
    let myNode = {
        from: node.from,
        to: node.to,
        firstChild: node.firstChild,
        name: node.name,
        type: nodeType,
        text: text,
    };

    return myNode;
}

// Text extraction is now handled directly in cleanupNode


// Helper function to find the parent node, handling special cases
function findParentNode(node, state) {
    if (!node || !node.parent) return null;

    // Skip top-level nodes
    if (node.parent.name === 'Program' || node.parent.name === 'TopLevel' || node.parent.name === 'Document') {
        return null;
    }

    // If we're already on a container (List, Vector, Map), get its parent
    const text = state.sliceDoc(node.from, node.to);
    if ((text.startsWith('[') && text.endsWith(']')) ||
        (text.startsWith('(') && text.endsWith(')')) ||
        (text.startsWith('{') && text.endsWith('}'))) {
        // We're on a container, so get its parent
        return node.parent ? cleanupNode(node.parent, state) : null;
    }

    // For all other nodes, get the parent container
    // This will automatically skip brackets and operators due to cleanupNode
    return cleanupNode(node.parent, state);
}

// Helper function to find siblings by traversing the parent's children
function findSiblings(node, state) {
    if (!node || !node.parent) return { leftSibling: null, rightSibling: null };

    // If we're on a bracket or operator, we need to get the actual node first
    if (isBracketOrParen(node.name) || node.name === 'Operator') {
        // We're on a bracket or operator, so we need to get the parent container
        const container = cleanupNode(node, state);
        // Now find siblings of the container
        return findSiblings(container, state);
    }

    const parent = node.parent;
    if (!parent.firstChild) return { leftSibling: null, rightSibling: null };

    // Get the text of the parent to determine if we're in a container
    const parentText = state.sliceDoc(parent.from, parent.to);
    
    // If parent is a container like [a], where 'a' is the only element, return null siblings
    if ((parentText.startsWith('[') && parentText.endsWith(']')) ||
        (parentText.startsWith('(') && parentText.endsWith(')')) ||
        (parentText.startsWith('{') && parentText.endsWith('}'))) {
        
        // Count meaningful children (non-bracket, non-whitespace elements)
        let meaningfulChildren = 0;
        let child = parent.firstChild;
        while (child) {
            if (!isBracketOrParen(child.name) &&
                child.name !== 'Operator' &&
                child.name !== 'Whitespace' &&
                child.name !== 'Comment') {
                meaningfulChildren++;
            }
            child = child.nextSibling;
        }
        
        // If there's only one meaningful child (or none), return null siblings
        if (meaningfulChildren <= 1) {
            return { leftSibling: null, rightSibling: null };
        }
    }

    // Collect all meaningful children of the parent (skip brackets, operators, whitespace, etc.)
    const children = [];
    let child = parent.firstChild;
    while (child) {
        // Skip brackets, operators, whitespace, and comments
        if (!isBracketOrParen(child.name) &&
            child.name !== 'Operator' &&
            child.name !== 'Whitespace' &&
            child.name !== 'Comment') {
            children.push(child);
        }
        child = child.nextSibling;
    }

    // If we have no meaningful children, return null siblings
    if (children.length <= 1) {
        return { leftSibling: null, rightSibling: null };
    }

    // Find the current node's index among siblings
    const idx = children.findIndex(n => n.from === node.from && n.to === node.to);
    if (idx === -1) return { leftSibling: null, rightSibling: null };

    // Get left and right siblings
    const leftSibling = idx > 0 ? cleanupNode(children[idx - 1], state) : null;
    const rightSibling = idx < children.length - 1 ? cleanupNode(children[idx + 1], state) : null;

    return { leftSibling, rightSibling };
}

// Helper function to find the first child of a node
function findFirstChild(node, state) {
    if (!node || !node.firstChild) return null;

    // If we're on a bracket or operator, we need to get the actual node first
    if (isBracketOrParen(node.name) || node.name === 'Operator') {
        // We're on a bracket or operator, so we need to get the parent container
        const container = cleanupNode(node, state);
        // Now find the first child of the container
        return findFirstChild(container, state);
    }

    // Skip non-content nodes like brackets, whitespace, etc.
    let child = node.firstChild;
    while (child) {
        // Skip brackets, operators, whitespace, and comments
        if (!isBracketOrParen(child.name) &&
            child.name !== 'Operator' &&
            child.name !== 'Whitespace' &&
            child.name !== 'Comment') {
            return cleanupNode(child, state);
        }
        child = child.nextSibling;
    }

    // If we didn't find a meaningful child, return null
    return null;
}

function getSiblingsAndFirstChild(rawNode, state) {
    // If we're on a bracket or operator, we need to get the actual node first
    if (isBracketOrParen(rawNode.name) || rawNode.name === 'Operator') {
        // We're on a bracket or operator, so we need to get the parent container
        const container = cleanupNode(rawNode, state);
        // Now get siblings and first child of the container
        const { leftSibling, rightSibling } = findSiblings(container, state);
        const firstChild = findFirstChild(container, state);

        return {
            leftSibling,
            rightSibling,
            // For backward compatibility
            prevSibling: leftSibling,
            nextSibling: rightSibling,
            firstChild
        };
    }

    // Use our helper functions to find siblings and first child
    const { leftSibling, rightSibling } = findSiblings(rawNode, state);
    const firstChild = findFirstChild(rawNode, state);

    return {
        leftSibling,
        rightSibling,
        // For backward compatibility
        prevSibling: leftSibling,
        nextSibling: rightSibling,
        firstChild
    };
}

export function stateToNodeContext(state) {
    let nodeInfo = null;
    if (state && state.selection) {
        const tree = syntaxTree(state);
        const pos = state.selection.main.head;

        // Find the most specific node at the cursor position
        // Use side = -1 to prefer the node that ends at the cursor position
        const rawNode = tree.resolve(pos, -1);

        // Create the current node, skipping brackets and operators
        const current = cleanupNode(rawNode, state);

        // Get parent node
        const parent = findParentNode(rawNode, state);

        // Get siblings and first child
        const { leftSibling, rightSibling, firstChild } = getSiblingsAndFirstChild(rawNode, state);

        // Attach relationships to current node for test compatibility
        current.prevSibling = leftSibling;
        current.nextSibling = rightSibling;
        current.firstChild = firstChild;
        current.parent = parent;

        // Create the node context object
        nodeInfo = {
            current: current,
            parent: parent,
            leftSibling: leftSibling,
            rightSibling: rightSibling,
            firstChild: firstChild
        };
    }
    return nodeInfo;
}


// State field to track the current node and its context
export const nodeTrackingField = StateField.define({
    create(state) {
        return stateToNodeContext(state);
    },
    update(value, tr) {
        let current = value;
        let newValue = null;

        // Handle setting the current node via navigation effect
        for (let e of tr.effects) {
            if (e.is(setCurrentNodeEffect)) {
                dbg("Current node from effect", e.value);
                newValue = e.value;
                console.log("DEBUG currentNode update - Set from effect:", current);
                break;
            }
        }

        // If no current node from effects and selection changed, find node at cursor
        if (!newValue && tr.selection) {
            newValue = stateToNodeContext(tr.state);
        }
        return newValue;
    }
});

// State field for tracking the last evaluated code (commented out for now)
export const lastEvaluatedCode = StateField.define({
    create() {
        return { from: 0, to: 0 };
    },
    update(value, _tr) {
        // Ignore transaction, just return the current value
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

        // Check if lastEvaluatedCode field exists before trying to access it
        if (tr.state.field(lastEvaluatedCode, false)) {
            const lastEvaluated = tr.state.field(lastEvaluatedCode);
            if (lastEvaluated && lastEvaluated.from < lastEvaluated.to) {
                return Decoration.set([
                    highlightDecoration.range(lastEvaluated.from, lastEvaluated.to)
                ]);
            }
        }

        return Decoration.none;
    },
    provide: field => EditorView.decorations.from(field)
});


// Export all extensions
export let structureExtensions = [
    nodeTrackingField,
    lastEvaluatedCode,
    // nodeHighlightField,
    highlightField
];
