// Simple, functional navigation commands for CodeMirror using SyntaxNode.resolve.
// These functions do not mutate state; they return new selection positions or perform navigation
// by dispatching a transaction on the provided Editorstate instance.

import { EditorSelection, StateField, Transaction, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { ASTCursor } from "../../utils/astCursor.mjs";
import { EditorView, Decoration, ViewPlugin } from "@codemirror/view";
import { serialVisPalette } from "../../ui/serialVis/utils.mjs";

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

function distributeWhitespace(children, parentFrom, parentTo) {
    if (!children || children.length === 0) return [];

    const result = [];

    // Process the first child
    const firstChild = { ...children[0] };
    result.push(firstChild);

    // Process middle children with whitespace distribution
    for (let i = 1; i < children.length; i++) {
        const prev = result[i - 1];
        const current = { ...children[i] };

        // Calculate whitespace between elements
        const whitespace = current.from - prev.to;
        if (whitespace > 0) {
            if (whitespace === 1) {
                prev.to += 1;
            } else {
                const half = Math.floor(whitespace / 2);
                prev.to += half;
                current.from = prev.to;
            }
        }

        result.push(current);
    }

    // --- FIX: Do NOT extend last child's .to to parentTo ---
    // The last child's .to should remain as-is, so it doesn't include the closing delimiter.
    // Remove or comment out the following lines:
    // if (result.length > 0) {
    //     const last = result[result.length - 1];
    //     last.to = parentTo;
    // }

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
export function getTrimmedRange(node, state) {
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
        // console.log("[nodeHighlightField.update] cursor:", cursor);
        if (!cursor || !cursor.getNode) return Decoration.none;
        const node = cursor.getNode();
        // console.log("[nodeHighlightField.update] node:", node);
        const range = getTrimmedRange(node, tr.state);
        // console.log("[nodeHighlightField.update] range:", range);
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

// --- New: StateField to track last child index for navigation ---
export const lastChildIndexField = StateField.define({
    create() {
        return null; // { parentPath: [...], childIndex: n }
    },
    update(value, tr) {
        const meta = tr.annotation(lastChildIndexAnnotation);
        if (meta && typeof meta.childIndex === "number" && Array.isArray(meta.parentPath)) {
            return { parentPath: meta.parentPath, childIndex: meta.childIndex };
        }
        if (meta && meta.reset) {
            return null;
        }
        return value;
    }
});

import { Annotation } from "@codemirror/state";
export const lastChildIndexAnnotation = Annotation.define();

// Helper: get path to node at position
function getChildIndexFromPath(path) {
    if (!Array.isArray(path) || path.length === 0) return 0;
    return path[path.length - 1];
}

function getParentPath(path) {
    if (!Array.isArray(path) || path.length === 0) return [];
    return path.slice(0, -1);
}

// --- Navigation commands for structure navigation ---

/**
 * Move cursor in (to first child node or last visited child) and return a transaction to update selection.
 */
export function navigateIn(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.hasChildren()) {
        return null;
    }
    const lastChildInfo = state.field(lastChildIndexField, false);
    const currentPath = cursor.getPath ? cursor.getPath() : [];
    let childIndex = 0;
    if (
        lastChildInfo &&
        Array.isArray(lastChildInfo.parentPath) &&
        JSON.stringify(lastChildInfo.parentPath) === JSON.stringify(currentPath) &&
        typeof lastChildInfo.childIndex === "number"
    ) {
        childIndex = lastChildInfo.childIndex;
    }
    const node = cursor.getNode ? cursor.getNode() : null;
    const children = node && node.children ? node.children : [];
    if (childIndex < 0 || childIndex >= children.length) {
        childIndex = 0;
    }
    const fork = cursor.fork().in(childIndex);
    const childNode = fork.getNode();
    if (!childNode || typeof childNode.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(childNode.from),
        scrollIntoView: true,
        annotations: lastChildIndexAnnotation.of({ reset: true })
    });
}

/**
 * Move cursor out (to parent node) and return a transaction to update selection.
 */
export function navigateOut(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.canGoOut()) {
        return null;
    }
    const currentPath = cursor.getPath ? cursor.getPath() : [];
    const parentPath = getParentPath(currentPath);
    const childIndex = getChildIndexFromPath(currentPath);
    const fork = cursor.fork().out();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true,
        annotations: lastChildIndexAnnotation.of({ parentPath, childIndex })
    });
}

/**
 * Move cursor to previous sibling and return a transaction to update selection.
 * Resets lastChildIndexField.
 */
export function navigatePrev(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.hasPrev()) {
        return null;
    }
    const fork = cursor.fork().prev();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true,
        annotations: lastChildIndexAnnotation.of({ reset: true })
    });
}

/**
 * Move cursor to next sibling and return a transaction to update selection.
 * Resets lastChildIndexField.
 */
export function navigateNext(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.hasNext()) {
        return null;
    }
    const fork = cursor.fork().next();
    const node = fork.getNode();
    if (!node || typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true,
        annotations: lastChildIndexAnnotation.of({ reset: true })
    });
}

// --- Match Decorator for 'a' or 'd' followed by digit and space (underline with palette color) ---

// Helper: get palette based on theme (light/dark)
function getCurrentPalette() {
  const isDark = document.documentElement.classList.contains("cm-theme-dark") ||
                 window.matchMedia("(prefers-color-scheme: dark)").matches;
  // If you have a dark palette, use it here. Otherwise, fallback to serialVisPalette.
  // Example: return isDark ? serialVisPaletteDark : serialVisPalette;
  return serialVisPalette;
}

// Map pattern to palette index
function getMatchColor(match) {
  const palette = getCurrentPalette();
  const [full, type, digit] = match;
  if (type === "a") {
    if (digit === "1") return palette[0];
    if (digit === "2") return palette[1];
    if (digit === "3") return palette[2];
  }
  if (type === "d") {
    if (digit === "1") return palette[2];
    if (digit === "2") return palette[3];
    if (digit === "3") return palette[4];
  }
  return palette[0];
}

// Regex: 'a' or 'd', then digit, then space (but don't include space in match)
const matchPattern = /\b([ad])([1-3])(?= )/g;

// Decoration plugin
export const matchDecorator = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view);
  }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }
  buildDecorations(view) {
    const builder = new RangeSetBuilder();
    for (let { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      let match;
      while ((match = matchPattern.exec(text)) !== null) {
        const start = from + match.index;
        const end = start + match[0].length;
        const color = getMatchColor(match);
        builder.add(
          start,
          end,
          Decoration.mark({
            class: "cm-match-underline",
            attributes: {
              style: `text-decoration: underline solid 2px ${color}; text-underline-offset: 2px; color: ${color} !important; border-color: ${color} !important;`
            }
          })
        );
      }
    }
    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});

// Export the structural extension as just the state field
// Consumers can add their own event handlers to call the navigation functions
export let structureExtensions = [
    nodeTreeField,
    nodeTreeCursorField,
    nodeHighlightField,
    lastChildIndexField,
    // nodeTreeCursorContextField
    matchDecorator
];

console.log("[structure.mjs] nodeHighlightField:", nodeHighlightField);
console.log("[structure.mjs] structureExtensions:", structureExtensions);