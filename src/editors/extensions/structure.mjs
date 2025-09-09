// Simple, functional navigation commands for CodeMirror using SyntaxNode.resolve.
// These functions do not mutate state; they return new selection positions or perform navigation
// by dispatching a transaction on the provided Editorstate instance.

import { EditorSelection, StateField, Transaction, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { ASTCursor } from "../../utils/astCursor.mjs";
import { EditorView, Decoration, ViewPlugin, gutter, GutterMarker } from "@codemirror/view";
import { serialVisPalette } from "../../ui/serialVis/utils.mjs";
import { sendTouSEQ, isConnectedToModule } from "../../io/serialComms.mjs";
import { activeUserSettings } from "../../utils/persistentUserSettings.mjs";

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

export function isStructuralToken(type) {
    return ["(", ")", "[", "]", "{", "}", "Brace", "Bracket", "Paren"].includes(type);
}

export function isOperatorNode(node) {
    return !!(node && node.type === "Operator" && node.children && node.children.length > 0);
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

export function isContainerNode(node) {
    return !!(node && (node.type === "List" || node.type === "Vector" ||
        node.type === "Program" || node.type === "Map"));
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
export const settingsChangedAnnotation = Annotation.define();

// --- Expression Evaluation Tracking ---

// Annotation for expression evaluation events
export const expressionEvaluatedAnnotation = Annotation.define();

// StateField to track last evaluated expression for each type (a1, a2, a3, d1, d2, d3)
export const lastEvaluatedExpressionField = StateField.define({
    create() {
        return new Map(); // expressionType -> { from, to, line }
    },
    update(value, tr) {
        // Process all annotations in this transaction (may be multiple types)
        const anns = tr.annotations || [];
        if (anns.length) {
            let updated = false;
            const newMap = new Map(value);
            for (const ann of anns) {
                if (ann.type === expressionEvaluatedAnnotation) {
                    const meta = ann.value || {};
                    if (meta && meta.expressionType) {
                        if (meta.clear) {
                            newMap.delete(meta.expressionType);
                            updated = true;
                        } else if (meta.position !== undefined) {
                            newMap.set(meta.expressionType, {
                                from: meta.position.from,
                                to: meta.position.to,
                                line: meta.position.line
                            });
                            updated = true;
                        }
                    }
                }
            }
            if (updated) return newMap;
        }
        return value;
    }
});

// --- Pure functions for expression detection ---

// Pure function: Find expression at cursor position
export function findExpressionAtPosition(cursor, lineText, lineFrom, findBoundsFn) {
    let match;
    matchPattern.lastIndex = 0;
    
    while ((match = matchPattern.exec(lineText)) !== null) {
        const matchStart = lineFrom + match.index;
        const bounds = findBoundsFn(matchStart);
        const boundsStartPos = bounds.startPos;
        const boundsEndPos = bounds.endPos;
        
        if (cursor >= boundsStartPos && cursor <= boundsEndPos) {
            return {
                expressionType: `${match[1]}${match[2]}`, // e.g., "a1", "d2"
                position: {
                    from: boundsStartPos,
                    to: boundsEndPos,
                    line: bounds.from
                }
            };
        }
    }
    
    return null;
}

// Helper function to detect expression at cursor and dispatch evaluation annotation
export function detectAndTrackExpressionEvaluation(view) {
    const state = view.state;
    const doc = state.doc;
    const ui = (activeUserSettings && activeUserSettings.ui) || {};
    if (ui.expressionLastTrackingEnabled === false) {
        return;
    }

    // Determine evaluated top-level range using the same cursor-derived logic as highlight
    const cursorField = state.field(nodeTreeCursorField, false);
    let evalFrom = 0, evalTo = 0;
    if (cursorField && cursorField.getPath) {
        const path = cursorField.getPath();
        if (Array.isArray(path) && path.length > 0) {
            const topIndex = path[0];
            let topNode = cursorField.root;
            if (topNode && topNode.children && topNode.children.length > topIndex) {
                const tn = topNode.children[topIndex];
                if (typeof tn.from === 'number' && typeof tn.to === 'number') {
                    evalFrom = tn.from;
                    evalTo = tn.to;
                }
            }
        } else {
            // Fallback: whole document
            evalFrom = 0;
            evalTo = doc.length;
        }
    }

    if (evalFrom === evalTo) return; // nothing to do

    // Scan all lines within the evaluated range and pick the last occurrence per expression type
    const startLineNum = doc.lineAt(evalFrom).number;
    const endLineNum = doc.lineAt(evalTo).number;
    const lastInChunk = new Map(); // exprType -> { expressionType, position, matchStart }

    for (let lineNum = startLineNum; lineNum <= endLineNum; lineNum++) {
        const lineObj = doc.line(lineNum);
        const lineText = lineObj.text;
        const lineFrom = lineObj.from;
        let match;
        matchPattern.lastIndex = 0;
        while ((match = matchPattern.exec(lineText)) !== null) {
            const matchStart = lineFrom + match.index;
            if (matchStart < evalFrom || matchStart > evalTo) continue;
            const bounds = findExpressionBounds(state, matchStart);
            const exprType = `${match[1]}${match[2]}`;
            const info = {
                expressionType: exprType,
                position: {
                    from: doc.line(bounds.from).from,
                    to: doc.line(bounds.to).to,
                    line: bounds.from
                },
                matchStart
            };
            const prev = lastInChunk.get(exprType);
            if (!prev || prev.matchStart <= info.matchStart) {
                lastInChunk.set(exprType, info);
            }
        }
    }

    if (lastInChunk.size > 0) {
        const annotations = Array.from(lastInChunk.values()).map(info =>
            expressionEvaluatedAnnotation.of({ expressionType: info.expressionType, position: info.position })
        );
        view.dispatch({ annotations });
    }
}

// Helper: get path to node at position
export function getChildIndexFromPath(path) {
    if (!Array.isArray(path) || path.length === 0) return 0;
    return path[path.length - 1];
}

export function getParentPath(path) {
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

// --- Expression Gutter for 'a' or 'd' followed by digit and space ---

// Helper: get palette based on theme (light/dark)
export function getCurrentPalette(doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null) {
  // Fallback to light theme if no DOM available
  if (!doc || !win) {
    return serialVisPalette;
  }
  
  const isDark = doc.documentElement.classList.contains("cm-theme-dark") ||
                 win.matchMedia("(prefers-color-scheme: dark)").matches;
  // If you have a dark palette, use it here. Otherwise, fallback to serialVisPalette.
  // Example: return isDark ? serialVisPaletteDark : serialVisPalette;
  return serialVisPalette;
}

// Map pattern to palette index
export function getMatchColor(match) {
  const palette = getCurrentPalette();
  const digit = Number(match[2] || 1);
  return palette[(digit - 1) % palette.length];
}

// Regex: 'a' or 'd', then digit, then space (but don't include space in match)
const matchPattern = /\b([ads])([1-8])(?= )/g;

// Custom gutter marker for expression vertical lines
export class ExpressionGutterMarker extends GutterMarker {
  constructor(color, isStart = false, isEnd = false, isMid = false, isActive = true, exprType = null, showClear = false) {
    super();
    this.color = color;
    this.isStart = isStart;
    this.isEnd = isEnd;
    this.isMid = isMid;
    this.isActive = isActive;
    this.exprType = exprType;
    this.showClear = showClear;
  }
  
  toDOM(createElement = (tag) => document.createElement(tag)) {
    const div = createElement('div');
    div.style.cssText = `
      position: relative;
      width: 14px;
      height: 100%;
      margin-left: 2px;
    `;
    
    if (this.isStart || this.isMid || this.isEnd) {
      const line = createElement('div');
      const opacity = this.isActive ? '1.0' : '0.3';
      line.style.cssText = `
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: 4px;
        background-color: ${this.color};
        opacity: ${opacity};
        height: 100%;
      `;
      div.appendChild(line);
    }

    // Add clear button centered on the bar when active start line
    if (this.showClear && this.isActive && this.exprType) {
      const btn = createElement('span');
      btn.className = 'cm-expr-clear-btn';
      btn.dataset.expr = this.exprType;
      btn.textContent = '×';
      btn.title = `Clear ${this.exprType}`;
      // Use the expression color as background; choose contrasting text color
      const bg = this.color || '#888';
      // Compute simple luminance for contrast decision
      let fg = '#000';
      try {
        const hex = bg.startsWith('#') ? bg.substring(1) : null;
        if (hex && (hex.length === 6 || hex.length === 3)) {
          const hx = hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex;
          const r = parseInt(hx.substring(0,2),16);
          const g = parseInt(hx.substring(2,4),16);
          const b = parseInt(hx.substring(4,6),16);
          const luminance = 0.299*r + 0.587*g + 0.114*b;
          fg = luminance > 140 ? '#000' : '#fff';
        } else {
          // Fallback for rgba()/named colors: default to white text
          fg = '#fff';
        }
      } catch (e) { fg = '#fff'; }
      btn.style.cssText = `
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 14px;
        height: 14px;
        line-height: 14px;
        text-align: center;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        user-select: none;
        color: ${fg};
        background: ${bg};
        border-radius: 4px;
        z-index: 5;
      `;
      div.appendChild(btn);
    }
    
    return div;
  }
  
  eq(other) {
    return other instanceof ExpressionGutterMarker && 
           other.color === this.color &&
           other.isStart === this.isStart &&
           other.isEnd === this.isEnd &&
           other.isMid === this.isMid &&
           other.isActive === this.isActive &&
           other.exprType === this.exprType &&
           other.showClear === this.showClear;
  }
}

// Helper: find expression boundaries by looking for brackets
function findExpressionBounds(state, matchPos) {
  const doc = state.doc;
  const tree = syntaxTree(state);
  
  // Find the node at the match position
  const node = tree.resolveInner(matchPos, 1);
  
  // Walk up the tree to find the containing expression (list/vector/etc)
  let current = node;
  while (current && !['List', 'Vector', 'Map'].includes(current.name)) {
    current = current.parent;
  }
  
  if (current) {
    return {
      from: state.doc.lineAt(current.from).number,
      to: state.doc.lineAt(current.to).number
    };
  }
  
  // Fallback: just the current line
  const line = state.doc.lineAt(matchPos);
  return {
    from: line.number,
    to: line.number
  };
}

// --- Pure functions for expression tracking logic ---

// Pure function: Find all expression ranges in document text
export function findExpressionRanges(docLines, findBoundsFn) {
    const expressionRanges = new Map(); // expressionType -> [{color, from, to, matchStart}, ...]
    
    for (let lineNum = 1; lineNum <= docLines.length; lineNum++) {
        const lineText = docLines[lineNum - 1].text;
        const lineFrom = docLines[lineNum - 1].from;
        let match;
        matchPattern.lastIndex = 0; // Reset regex
        
        while ((match = matchPattern.exec(lineText)) !== null) {
            const matchStart = lineFrom + match.index;
            const expressionType = `${match[1]}${match[2]}`; // e.g., "a1", "d2"
            const color = getMatchColor(match);
            const bounds = findBoundsFn(matchStart);
            
            if (!expressionRanges.has(expressionType)) {
                expressionRanges.set(expressionType, []);
            }
            expressionRanges.get(expressionType).push({
                color,
                from: bounds.from,
                to: bounds.to,
                matchStart
            });
        }
    }
    
    return expressionRanges;
}

// Pure function: Determine if a range is active based on last evaluation
export function isRangeActive(range, lastEvaluated) {
    if (!lastEvaluated) return false;
    
    const rangeStartLine = range.from;
    const rangeEndLine = range.to;
    return lastEvaluated.line >= rangeStartLine && lastEvaluated.line <= rangeEndLine;
}

// Pure function: Create markers for an expression range
export function createMarkersForRange(range, isActive, docLineFn, exprType) {
    const markers = [];
    const midLine = Math.floor((range.from + range.to) / 2);
    
    for (let line = range.from; line <= range.to; line++) {
        const isStart = line === range.from;
        const isEnd = line === range.to;
        const isMid = !isStart && !isEnd;
        const ui = (activeUserSettings && activeUserSettings.ui) || {};
        const showClear = (ui.expressionClearButtonEnabled !== false) && isActive && (line === midLine);
        const marker = new ExpressionGutterMarker(range.color, isStart, isEnd, isMid, isActive, exprType, showClear);
        const lineObj = docLineFn(line);
        markers.push({
            pos: lineObj.from,
            marker: marker
        });
    }
    
    return markers;
}

// Pure function: Process all expression ranges and create markers
export function processExpressionRanges(expressionRanges, lastEvaluatedMap, docLineFn) {
    const allMarkers = [];
    
    for (const [expressionType, ranges] of expressionRanges) {
        const lastEval = lastEvaluatedMap.get(expressionType);
        
        for (const range of ranges) {
            const isActive = isRangeActive(range, lastEval);
            const markers = createMarkersForRange(range, isActive, docLineFn, expressionType);
            allMarkers.push(...markers);
        }
    }
    
    // Sort markers by position
    allMarkers.sort((a, b) => a.pos - b.pos);
    
    return allMarkers;
}

// Helper function to build markers (now uses pure functions)
function buildMarkers(state) {
    const builder = new RangeSetBuilder();
    const doc = state.doc;
    // Respect settings toggles
    const ui = (activeUserSettings && activeUserSettings.ui) || {};
    if (ui.expressionGutterEnabled === false) {
        return builder.finish();
    }
    const lastEvaluatedRaw = state.field(lastEvaluatedExpressionField, false) || new Map();
    const lastEvaluated = ui.expressionLastTrackingEnabled === false ? new Map() : lastEvaluatedRaw;
    
    // Create array of line objects for pure function
    const docLines = [];
    for (let line = 1; line <= doc.lines; line++) {
        docLines.push(doc.line(line));
    }
    
    // Pure function calls
    const expressionRanges = findExpressionRanges(docLines, (matchStart) => 
        findExpressionBounds(state, matchStart)
    );
    
    const markers = processExpressionRanges(
        expressionRanges, 
        lastEvaluated, 
        (lineNum) => doc.line(lineNum)
    );
    
    // Add sorted markers to builder
    for (const {pos, marker} of markers) {
        builder.add(pos, pos, marker);
    }
    
    return builder.finish();
}

// State field for expression gutter markers
const expressionGutterField = StateField.define({
  create(state) {
    return buildMarkers(state);
  },
  
  update(markers, tr) {
    // Rebuild markers when document changes OR when last-evaluated map changes
    if (tr.docChanged) {
      return buildMarkers(tr.state);
    }
    const prevMap = tr.startState.field(lastEvaluatedExpressionField, false);
    const nextMap = tr.state.field(lastEvaluatedExpressionField, false);
    if (prevMap !== nextMap) {
      return buildMarkers(tr.state);
    }
    const settingsChanged = tr.annotation(settingsChangedAnnotation);
    if (settingsChanged) {
      return buildMarkers(tr.state);
    }
    return markers;
  }
});

// View plugin to handle click on clear icons
const expressionClearClickPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.onClick = this.onClick.bind(this);
    this.onSettingsChange = this.onSettingsChange.bind(this);
    view.dom.addEventListener('click', this.onClick);
    window.addEventListener('useq-settings-changed', this.onSettingsChange);
  }
  destroy() {
    this.view.dom.removeEventListener('click', this.onClick);
    window.removeEventListener('useq-settings-changed', this.onSettingsChange);
  }
  onClick(e) {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('.cm-expr-clear-btn');
    if (!btn) return;
    const ui = (activeUserSettings && activeUserSettings.ui) || {};
    if (ui.expressionClearButtonEnabled === false) return;
    e.preventDefault();
    e.stopPropagation();
    const exprType = btn.getAttribute('data-expr');
    if (!exprType) return;
    handleClearExpression(this.view, exprType);
  }
  onSettingsChange() {
    // Trigger rebuild of fields that depend on settings
    try {
      this.view.dispatch({ annotations: settingsChangedAnnotation.of(true) });
    } catch (e) {}
  }
});

function handleClearExpression(view, exprType) {
  if (!isConnectedToModule || !isConnectedToModule()) {
    // Not connected; do nothing
    return;
  }
  // Send neutral value based on type
  const type = exprType[0];
  const code = type === 'a' ? `(${exprType} 0.5)` : `(${exprType} 0)`;
  try { sendTouSEQ(code); } catch (e) {
    // ignore
  }
  // Clear active state for this expression type
  view.dispatch({ annotations: expressionEvaluatedAnnotation.of({ expressionType: exprType, clear: true }) });
}

// Create the expression gutter
export const expressionGutter = gutter({
  class: 'cm-expression-gutter',
  markers: v => v.state.field(expressionGutterField),
  initialSpacer: () => new ExpressionGutterMarker('#transparent', false, false, false, true),
  domEventHandlers: {}
});

// Export the structural extension as just the state field
// Consumers can add their own event handlers to call the navigation functions
export let structureExtensions = [
    nodeTreeField,
    nodeTreeCursorField,
    nodeHighlightField,
    lastChildIndexField,
    lastEvaluatedExpressionField,
    expressionClearClickPlugin,
    expressionGutterField,
    expressionGutter
];

console.log("[structure.mjs] nodeHighlightField:", nodeHighlightField);
console.log("[structure.mjs] structureExtensions:", structureExtensions);
