// Simple, functional navigation commands for CodeMirror using SyntaxNode.resolve.
// These functions do not mutate state; they return new selection positions or perform navigation
// by dispatching a transaction on the provided Editorstate instance.

import { EditorSelection, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { ASTCursor } from "../../utils/astCursor.mjs";
import { EditorView, Decoration } from "@codemirror/view";

// Helper functions for tree processing
function treeToJson(node, state) {
    // For structural tokens like parentheses, include the full text including their contents
    const isStructural = isStructuralToken(node.type.name);
    const text = state.sliceDoc(
        node.from,
        node.to
    );

    return {
        type: node.type.name,
        from: node.from,
        to: node.to,
        text: isStructural ? text : text,
        children: collectChildren(node, state)
    };
}

function collectChildren(node, state) {
    const children = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
        children.push(treeToJson(child, state));
    }
    return children.length > 0 ? children : undefined;
}

function isStructuralToken(type) {
    return ["(", ")", "[", "]", "{", "}", "Brace", "Bracket", "Paren"].includes(type);
}

function isOperatorNode(node) {
    return node.type === "Operator" && node.children && node.children.length > 0;
}

function filterStructuralAndLiftOperatorNodes(node) {
    if (isStructuralToken(node.type)) {
        if (node.children) {
            return node.children.map(filterStructuralAndLiftOperatorNodes).filter(Boolean).flat();
        }
        return undefined;
    }
    if (isOperatorNode(node)) {
        // Replace Operator node with its first child (lift it)
        return filterStructuralAndLiftOperatorNodes(node.children[0]);
    }
    const children = node.children
        ? node.children.map(filterStructuralAndLiftOperatorNodes).filter(Boolean).flat()
        : undefined;
    return { ...node, children };
}

function isContainerNode(node) {
    return node.type === "List" || node.type === "Vector" ||
        node.type === "Program" || node.type === "Map";
}

function distributeWhitespace(children, _parentFrom, parentTo) {
    if (!children || children.length === 0) return [];

    const result = [];

    // Process the first child
    const firstChild = { ...children[0] };
    // Include opening delimiters in the parent's range
    result.push(firstChild);

    // Process middle children with whitespace distribution
    for (let i = 1; i < children.length; i++) {
        const prev = result[i - 1];
        const current = { ...children[i] };

        // Calculate whitespace between elements
        const whitespace = current.from - prev.to;
        if (whitespace > 0) {
            if (whitespace === 1) {
                // Assign single whitespace to the left element
                prev.to += 1;
                // current.from remains unchanged
            } else {
                // Split whitespace, favoring next element if odd number of spaces (except for 1)
                const half = Math.floor(whitespace / 2);
                prev.to += half;
                current.from = prev.to;
            }
        }

        result.push(current);
    }

    // Ensure the last child extends to include closing delimiters
    if (result.length > 0) {
        const last = result[result.length - 1];
        last.to = parentTo;
    }

    return result;
}

function createAdjustedTree(node) {
    // Non-container nodes pass through unchanged
    if (!isContainerNode(node)) {
        return {
            ...node,
            children: node.children ? node.children.map(createAdjustedTree) : undefined
        };
    }

    // For container nodes, process children first
    const processedChildren = node.children
        ? node.children.map(createAdjustedTree)
        : [];

    // Then distribute whitespace among children
    const adjustedChildren = distributeWhitespace(
        processedChildren,
        node.from,
        node.to
    );

    // Return the node with adjusted children
    return {
        ...node,
        children: adjustedChildren
    };
}

function resolveNodeAtPosition(tree, pos) {
    // Base case: outside tree bounds
    if (pos < tree.from || pos >= tree.to) return null;

    // If this is a container node with children, delegate to them
    if (isContainerNode(tree) && tree.children && tree.children.length > 0) {
        for (const child of tree.children) {
            if (pos >= child.from && pos < child.to) {
                return resolveNodeAtPosition(child, pos);
            }
        }

        // If we get here, position is in the container but not in any child
        // This shouldn't happen with proper whitespace distribution
        return tree;
    }

    // Non-container node or leaf node
    return tree;
}

// Helper: find path to node at a given position
function findPathToNodeAtPosition(node, pos, path = []) {
    if (pos < node.from || pos >= node.to) return null;
    if (!node.children || node.children.length === 0) return path;
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const childPath = findPathToNodeAtPosition(child, pos, [...path, i]);
        if (childPath) return childPath;
    }
    return path;
}

// Combines all tree adjustment steps into one function
function processSyntaxTree(state) {
    const tree = syntaxTree(state);
    const jsonTree = treeToJson(tree.topNode, state);
    const filteredTree = filterStructuralAndLiftOperatorNodes(jsonTree);
    const adjustedTree = createAdjustedTree(filteredTree);
    return adjustedTree;
}

// State field to track the processed syntax tree
export const nodeTreeField = StateField.define({
    create(state) {
        return processSyntaxTree(state);
    },

    update(value, transaction) {
        if (transaction.docChanged) {
            const processedTree =  processSyntaxTree(transaction.state);
            return processedTree;
        }
        else {
            return value;
        }
    }
});

// Function to print the current node of the ASTCursor
function printCurrentNode(cursor) {
    console.log("Printing current cursor node...");
    if (cursor && cursor.getNode) {
        // eslint-disable-next-line no-console
        console.log('ASTCursor current node:', cursor.getNode());
    }
}

// State field to track the ASTCursor for the current node tree
export const nodeTreeCursorField = StateField.define({
    create(state) {
        const nodeTree = state.field(nodeTreeField, false);
        const cursor = nodeTree ? new ASTCursor(nodeTree) : null;
        if (!cursor) return null;
        // Set cursor to node at initial selection
        const pos = state.selection?.main.head || 0;
        const path = nodeTree ? findPathToNodeAtPosition(nodeTree, pos) : [];
        cursor.setPath(path);
        printCurrentNode(cursor);
        return cursor;
    },
    update(prevCursor, tr) {
        console.log("nodeTreeCursorField update routine called...");

        const prevNodeTree = tr.startState.field(nodeTreeField, false);
        const nodeTree = tr.state.field(nodeTreeField, false);
        const prevPos = tr.startState.selection?.main.head || 0;
        const pos = tr.state.selection?.main.head || 0;
        // If nothing changed, return previous cursor
        if (nodeTree === prevNodeTree && pos === prevPos && prevCursor) {
            return prevCursor;
        }
        // If only the cursor position changed, reuse ASTCursor and just update path
        if (nodeTree === prevNodeTree && prevCursor) {
            const path = findPathToNodeAtPosition(nodeTree, pos);
            prevCursor.setPath(path);
            printCurrentNode(prevCursor);
            return prevCursor;
        }
        // Otherwise, create a new ASTCursor
        const cursor = nodeTree ? new ASTCursor(nodeTree) : null;
        if (!cursor) return null;
        const path = nodeTree ? findPathToNodeAtPosition(nodeTree, pos) : [];
        cursor.setPath(path);
        printCurrentNode(cursor);
        return cursor;
    }
});

// Helper to trim whitespace and get adjusted range
function getTrimmedRange(node, state) {
    if (!node || typeof node.from !== "number" || typeof node.to !== "number") return null;
    const text = state.sliceDoc(node.from, node.to);
    let startOffset = 0;
    let endOffset = text.length;
    // Find first non-whitespace
    while (startOffset < endOffset && /\s/.test(text[startOffset])) startOffset++;
    // Find last non-whitespace
    while (endOffset > startOffset && /\s/.test(text[endOffset - 1])) endOffset--;
    if (startOffset >= endOffset) return null; // all whitespace
    return {
        from: node.from + startOffset,
        to: node.from + endOffset
    };
}

// StateField for highlighting the current node (trimmed)
export const nodeHighlightField = StateField.define({
    create(state) {
        const cursor = state.field(nodeTreeCursorField, false);
        console.log("[nodeHighlightField.create] cursor:", cursor);
        if (!cursor || !cursor.getNode) return Decoration.none;
        const node = cursor.getNode();
        console.log("[nodeHighlightField.create] node:", node);
        const range = getTrimmedRange(node, state);
        console.log("[nodeHighlightField.create] range:", range);
        // Add parent node highlight
        let parentRange = null;
        let parentIsProgram = false;
        let parent = null;
        if (cursor.peekParent) {
            parent = cursor.peekParent();
            parentIsProgram = parent && parent.type === "Program";
            parentRange = getTrimmedRange(parent, state);
        }
        const decorations = [];
        if (range) {
            decorations.push(Decoration.mark({class: "cm-current-node"}).range(range.from, range.to));
        }
        if (parentIsProgram) {
            decorations.push(Decoration.mark({class: "cm-parent-node-editor-area"}).range(0, state.doc.length));
        } else if (parentRange) {
            decorations.push(Decoration.mark({class: "cm-parent-node"}).range(parentRange.from, parentRange.to));
        }
        decorations.sort((a, b) => a.from - b.from);
        return decorations.length ? Decoration.set(decorations) : Decoration.none;
    },
    update(deco, tr) {
        const cursor = tr.state.field(nodeTreeCursorField, false);
        console.log("[nodeHighlightField.update] cursor:", cursor);
        if (!cursor || !cursor.getNode) return Decoration.none;
        const node = cursor.getNode();
        console.log("[nodeHighlightField.update] node:", node);
        const range = getTrimmedRange(node, tr.state);
        console.log("[nodeHighlightField.update] range:", range);
        // Add parent node highlight
        let parentRange = null;
        let parentIsProgram = false;
        let parent = null;
        if (cursor.peekParent) {
            parent = cursor.peekParent();
            parentIsProgram = parent && parent.type === "Program";
            parentRange = getTrimmedRange(parent, tr.state);
        }
        const decorations = [];
        if (range) {
            decorations.push(Decoration.mark({class: "cm-current-node"}).range(range.from, range.to));
        }
        if (parentIsProgram) {
            decorations.push(Decoration.mark({class: "cm-parent-node-editor-area"}).range(0, tr.state.doc.length));
        } else if (parentRange) {
            decorations.push(Decoration.mark({class: "cm-parent-node"}).range(parentRange.from, parentRange.to));
        }
        decorations.sort((a, b) => a.from - b.from);
        return decorations.length ? Decoration.set(decorations) : Decoration.none;
    },
    provide: f => EditorView.decorations.from(f)
});

// === Navigation commands for structure navigation ===

/**
 * Move cursor in (to first child node) and return a transaction to update selection.
 */
export function navigateIn(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.hasChildren()) return null;
    const fork = cursor.fork().in();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') return null;
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor out (to parent node) and return a transaction to update selection.
 */
export function navigateOut(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.canGoOut()) return null;
    const fork = cursor.fork().out();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') return null;
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor to previous sibling and return a transaction to update selection.
 */
export function navigatePrev(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.hasPrev()) return null;
    const fork = cursor.fork().prev();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') return null;
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor to next sibling and return a transaction to update selection.
 */
export function navigateNext(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.hasNext()) return null;
    const fork = cursor.fork().next();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') return null;
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

// Export the structural extension as just the state field
// Consumers can add their own event handlers to call the navigation functions
export let structureExtensions = [
    nodeTreeField,
    nodeTreeCursorField,
    nodeHighlightField,
    // nodeTreeCursorContextField
];

console.log("[structure.mjs] nodeHighlightField:", nodeHighlightField);
console.log("[structure.mjs] structureExtensions:", structureExtensions);