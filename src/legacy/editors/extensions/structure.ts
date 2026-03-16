// @ts-nocheck
// Simple, functional navigation commands for CodeMirror using SyntaxNode.resolve.
// These functions do not mutate state; they return new selection positions or perform navigation
// by dispatching a transaction on the provided Editorstate instance.

import { EditorSelection, StateField, Transaction, RangeSetBuilder, Annotation } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { findNodeAt, navigationMetaField, navigationMetaEffect, navigateIn, navigateOut, navigateNext, navigatePrev, navigateRight, navigateLeft, navigateUp, navigateDown, isContainerNode as isContainerNodeInternal, isStructuralToken as isStructuralTokenInternal } from "./structure/new-structure.ts";
import { EditorView, Decoration, ViewPlugin, gutter, GutterMarker } from "@codemirror/view";
import { getSerialVisPalette, getSerialVisChannelColor } from "../../ui/serialVis/utils.ts";
import {
  VISUALISATION_SESSION_EVENT,
  addVisualisationEventListener,
} from "../../../contracts/visualisationEvents";
import { showVisualisationPanel } from "../../../ui/adapters/visualisationPanel";

// Re-export navigation functions for backward compatibility
export { navigateIn, navigateOut, navigateNext, navigatePrev, navigateRight, navigateLeft, navigateUp, navigateDown };

// Backward-compatible utility exports used by legacy tests/helpers.
export function isStructuralToken(nodeOrToken) {
    if (!nodeOrToken) return false;
    if (typeof nodeOrToken === "string") {
        return new Set(["(", ")", "[", "]", "{", "}", "Brace", "Bracket", "Paren", "#", "'", "LineComment", "BlockComment", "Comment"]).has(nodeOrToken);
    }
    if (nodeOrToken?.type && typeof nodeOrToken.type === "string") {
        return isStructuralToken(nodeOrToken.type);
    }
    return isStructuralTokenInternal(nodeOrToken);
}

export function isContainerNode(node) {
    if (!node) return false;
    if (typeof node.type === "string") {
        return new Set(["List", "Vector", "Program", "Map", "Set"]).has(node.type);
    }
    return isContainerNodeInternal(node);
}

export function isOperatorNode(node) {
    return Boolean(node && node.type === "Operator" && Array.isArray(node.children) && node.children.length > 0);
}

/**
 * Helper to apply a navigation function to a view, preserving the navigation metadata.
 * This is necessary because navigation functions return a State, but we need to dispatch a Transaction
 * that includes the navigationMetaEffect to persist the traversal history.
 * 
 * @param {EditorView} view - The editor view
 * @param {Function} navFunction - A function that takes EditorState and returns EditorState (e.g. navigateRight)
 * @returns {boolean} - True if navigation occurred (state changed), false otherwise
 */
export function performNavigation(view, navFunction) {
    const newState = navFunction(view.state);
    if (newState === view.state) return false;
    
    let newMeta = null;
    try {
        newMeta = newState.field(navigationMetaField);
        // console.log('performNavigation: retrieved meta', newMeta);
    } catch (e) {
        console.error('performNavigation: Failed to retrieve navigationMetaField', e);
    }

    const transactionSpec = {
        selection: newState.selection,
        scrollIntoView: true
    };
    
    if (newMeta) {
        transactionSpec.effects = navigationMetaEffect.of(newMeta);
    } else {
        console.warn('performNavigation: newMeta is null or undefined, navigation history might be lost');
    }
    
    view.dispatch(transactionSpec);
    return true;
}

import { sendTouSEQ, isConnectedToModule } from "../../io/serialComms.ts";
import {
  isExpressionVisualised,
  toggleVisualisation,
  reportExpressionColor,
  refreshVisualisedExpression,
  notifyExpressionEvaluated
} from "../../ui/serialVis/visualisationController.ts";
import { dbg } from "../../utils.ts";
import { getAppSettings, subscribeAppSettings } from "../../../runtime/appSettingsRepository.ts";

// Helper functions for tree processing - REMOVED in favor of standard syntax tree
// The new structural editing extension uses standard Lezer syntax tree and findNodeAt helper.

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

  function getContainerNodeAt(state, pos) {
    const tree = syntaxTree(state);
    let node = tree.resolveInner(pos, 0);
    while (node && node.parent && !isContainerNode(node)) {
      node = node.parent;
    }
    return node && isContainerNode(node) ? node : null;
  }

// StateField for highlighting the current node (trimmed)
export const nodeHighlightField = StateField.define({
    create(state) {
        const selection = state.selection.main;
        const node = findNodeAt(state, selection.from, selection.to);
        const containerNode = getContainerNodeAt(state, selection.from);
        if (!node && !containerNode) return Decoration.none;
        const range = node ? getTrimmedRange(node, state) : null;
        
        // Container highlight (list/vector/map/set)
        let parentRange = null;
        let parentIsProgram = false;
        const parent = containerNode;
        
        if (parent) {
            parentIsProgram = parent.type.name === "Program";
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
        if (!tr.docChanged && !tr.selection) return deco;
        
        try {
            const selection = tr.state.selection.main;
            const node = findNodeAt(tr.state, selection.from, selection.to);
            const containerNode = getContainerNodeAt(tr.state, selection.from);
            if (!node && !containerNode) return Decoration.none;

            const range = node ? getTrimmedRange(node, tr.state) : null;
            
            // Container highlight
            let parentRange = null;
            let parentIsProgram = false;
            const parent = containerNode;
            
            if (parent) {
                parentIsProgram = parent.type.name === "Program";
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
        } catch (e) {
            console.error("nodeHighlightField update failed", e);
            return Decoration.none;
        }
    },
    provide: f => EditorView.decorations.from(f)
});

// --- New: StateField to track last child index for navigation ---
// REMOVED: Replaced by navigationMetaField in new-structure.mjs

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
    const ui = (getAppSettings()?.ui) || {};
    if (ui.expressionLastTrackingEnabled === false) {
        return;
    }

    // Determine evaluated top-level range using standard syntax tree
    let evalFrom = 0, evalTo = doc.length;
    const selection = state.selection.main;
    let node = findNodeAt(state, selection.from, selection.to);
    
    if (node) {
        // Walk up to find the top-level node (child of Program)
        while (node.parent && node.parent.type.name !== "Program") {
            node = node.parent;
        }
        // If parent is Program, then 'node' is a top-level node
        if (node.parent && node.parent.type.name === "Program") {
            evalFrom = node.from;
            evalTo = node.to;
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
        const evaluations = Array.from(lastInChunk.values());
        const annotations = evaluations.map(info =>
            expressionEvaluatedAnnotation.of({ expressionType: info.expressionType, position: info.position })
        );
        view.dispatch({ annotations });

        for (const info of evaluations) {
            const exprType = info.expressionType;
            notifyExpressionEvaluated(exprType);

            if (!isExpressionVisualised(exprType)) {
                continue;
            }

            const definition = findExpressionDefinition(view, exprType);
            const newText = definition?.expressionText?.trim();
            if (!newText) {
                continue;
            }

            refreshVisualisedExpression(exprType, newText).catch((error) => {
                dbg(`Visualise: failed to refresh ${exprType} after evaluation: ${error}`);
            });
        }
    }
}

// Navigation commands have been moved to ./structure/new-structure.mjs

// --- Expression Gutter for 'a' or 'd' followed by digit and space ---

// Helper: get palette based on theme (light/dark)
export function getCurrentPalette(doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null) {
  // Fallback to light theme if no DOM available
  if (!doc || !win) {
    return getSerialVisPalette();
  }
  return getSerialVisPalette();
}

// Map pattern to palette index
export function getMatchColor(match) {
  const palette = getCurrentPalette();
  const offset = getAppSettings()?.visualisation?.circularOffset ?? 0;
  const exprType = `${match[1]}${match[2]}`;
  return getSerialVisChannelColor(exprType, offset, palette);
}

// Regex: 'a' or 'd' or 's', then digit, followed by whitespace, delimiter, or end of line
const matchPattern = /\b([ads])([1-8])(?=[\s)(]|$)/g;

// Custom gutter marker for expression vertical lines
export class ExpressionGutterMarker extends GutterMarker {
  constructor(color, isStart = false, isEnd = false, isMid = false, isActive = true, exprType = null, showPlayButton = false, isVisualised = false) {
    super();
    this.color = color;
    this.isStart = isStart;
    this.isEnd = isEnd;
    this.isMid = isMid;
    this.isActive = isActive;
    this.exprType = exprType;
    this.showPlayButton = showPlayButton;
    this.isVisualised = isVisualised;
  }
  
  toDOM() {
    const div = document.createElement('div');
    div.style.cssText = `
      position: relative;
      width: 16px;
      height: 100%;
      margin-left: 2px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
    `;
    div.style.pointerEvents = 'auto';
    const baseColor = this.color || 'var(--accent-color, #00ff41)';
    
    if (this.isStart || this.isMid || this.isEnd) {
      const line = document.createElement('div');
      const opacity = this.isActive ? '1.0' : '0.3';
      line.style.cssText = `
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: 4px;
        background-color: ${baseColor};
        opacity: ${opacity};
        height: 100%;
      `;
      line.style.pointerEvents = 'none';
      div.appendChild(line);
    }

    if (this.showPlayButton && this.exprType) {
      const btn = document.createElement('span');
      btn.className = 'cm-expr-play-btn';
      btn.dataset.expr = this.exprType;
      btn.textContent = '▶';
      btn.title = this.isVisualised
        ? `Stop visualising ${this.exprType}`
        : `Play ${this.exprType}`;
      btn.setAttribute('aria-pressed', this.isVisualised ? 'true' : 'false');

      const bg = this.isVisualised ? baseColor : 'rgba(0, 0, 0, 0.45)';
      let fg = this.isVisualised ? '#080808' : baseColor;
      if (this.isVisualised) {
        try {
          const hex = baseColor.startsWith('#') ? baseColor.substring(1) : null;
          if (hex && (hex.length === 6 || hex.length === 3)) {
            const hx = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
            const r = parseInt(hx.substring(0, 2), 16);
            const g = parseInt(hx.substring(2, 4), 16);
            const b = parseInt(hx.substring(4, 6), 16);
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            fg = luminance > 140 ? '#000' : '#fff';
          } else {
            fg = '#fff';
          }
        } catch (e) {
          fg = '#fff';
        }
      }

      if (this.isVisualised) {
        btn.classList.add('is-visualising');
      }

      btn.style.cssText = `
        position: absolute;
        left: 50%;
        top: 38%;
        transform: translate(-50%, -50%);
        width: 14px;
        height: 14px;
        line-height: 14px;
        text-align: center;
        font-size: 10px;
        font-weight: bold;
        cursor: pointer;
        user-select: none;
        color: ${fg};
        background: ${bg};
        border-radius: 4px;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid ${baseColor};
        box-shadow: ${this.isVisualised ? '0 0 6px rgba(0,0,0,0.35)' : 'none'};
      `;
      btn.style.pointerEvents = 'auto';
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
           other.showPlayButton === this.showPlayButton &&
           other.isVisualised === this.isVisualised;
  }
}

// Helper: find expression boundaries by looking for brackets
export function findExpressionBounds(state, matchPos) {
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

function findExpressionDefinition(view, exprType) {
  const state = view.state;
  const doc = state.doc;

  dbg(`Finding definition for ${exprType}`);

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const lineObj = doc.line(lineNum);
    const lineText = lineObj.text;
    const lineFrom = lineObj.from;

    let match;
    matchPattern.lastIndex = 0;
    while ((match = matchPattern.exec(lineText)) !== null) {
      const matchStart = lineFrom + match.index;
      const foundExprType = `${match[1]}${match[2]}`;
      if (foundExprType === exprType) {
        const bounds = findExpressionBounds(state, matchStart);
        const startLineObj = doc.line(bounds.from);
        const endLineObj = doc.line(bounds.to);
        const expressionText = doc.sliceString(startLineObj.from, endLineObj.to);
        dbg(`Found ${exprType} from ${bounds.from} to ${bounds.to}`);
        return {
          expressionText,
          from: startLineObj.from,
          to: endLineObj.to,
        };
      }
    }
  }

  dbg(`No definition located for ${exprType}`);
  return null;
}

function ensureSerialVisPanelVisible() {
  showVisualisationPanel({ emitAutoOpenEvent: true });
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
        const ui = (getAppSettings()?.ui) || {};
        
        // Show play button on middle line
        const buttonsEnabled = ui.expressionClearButtonEnabled !== false;
        const showPlayButton = buttonsEnabled && (line === midLine);

        const marker = new ExpressionGutterMarker(
          range.color,
          isStart,
          isEnd,
          isMid,
          isActive,
          exprType,
          showPlayButton,
          isExpressionVisualised(exprType)
        );
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
        const firstRange = ranges && ranges.length > 0 ? ranges[0] : null;
      reportExpressionColor(expressionType, firstRange ? firstRange.color : null);
        
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
    const ui = (getAppSettings()?.ui) || {};
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

// View plugin to handle expression gutter interactions
const expressionClearClickPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.onClick = this.onClick.bind(this);
    this.onSettingsChange = this.onSettingsChange.bind(this);
    this.onVisualisationChange = this.onVisualisationChange.bind(this);
    this.removeVisualisationListener = () => undefined;
    this.removeSettingsListener = () => undefined;
    view.dom.addEventListener('click', this.onClick);
    this.removeSettingsListener = subscribeAppSettings(() => this.onSettingsChange());
    this.removeVisualisationListener = addVisualisationEventListener(
      VISUALISATION_SESSION_EVENT,
      () => this.onVisualisationChange()
    );
  }
  destroy() {
    this.view.dom.removeEventListener('click', this.onClick);
    this.removeSettingsListener();
    this.removeVisualisationListener();
  }
  update(update) {
  }
  onClick(e) {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    
    // Handle play button (▶)
    const playBtn = target.closest('.cm-expr-play-btn');
    if (playBtn) {
      const ui = (getAppSettings()?.ui) || {};
      if (ui.expressionClearButtonEnabled === false) return;
      e.preventDefault();
      e.stopPropagation();
      const exprType = playBtn.getAttribute('data-expr');
      if (!exprType) return;
      handlePlayExpression(this.view, exprType);
      return;
    }
  }
  onSettingsChange() {
    // Trigger rebuild of fields that depend on settings
    try {
      this.view.dispatch({ annotations: settingsChangedAnnotation.of(true) });
    } catch (e) {}
  }
  onVisualisationChange() {
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

function handlePlayExpression(view, exprType) {
  const definition = findExpressionDefinition(view, exprType);
  if (!definition) {
    return;
  }

  const expressionText = definition.expressionText.trim();
  const connected = isConnectedToModule && isConnectedToModule();

  if (connected) {
    try {
      dbg(`Play: sending ${exprType}`);
      sendTouSEQ(expressionText);
    } catch (e) {
      dbg(`Play: failed to send ${exprType}: ${e}`);
    }
  }

  detectAndTrackExpressionEvaluation(view);

  handleVisualiseExpression(view, exprType, expressionText);
}

function handleVisualiseExpression(view, exprType, expressionTextOverride = null) {
  let expressionText = typeof expressionTextOverride === 'string'
    ? expressionTextOverride.trim()
    : expressionTextOverride;
  if (!expressionText) {
    const definition = findExpressionDefinition(view, exprType);
    if (!definition) {
      dbg(`Visualise: could not find definition for ${exprType}`);
      return;
    }
    expressionText = definition.expressionText.trim();
  }

  if (!expressionText) {
    dbg(`Visualise: empty expression for ${exprType}`);
    return;
  }

  const wasVisualised = isExpressionVisualised(exprType);

  if (typeof console !== 'undefined' && console.debug) {
    console.debug('useq:visualise-toggle', { exprType, wasVisualised, length: expressionText.length });
  }
  dbg(`Visualise: toggling ${exprType}, text length ${expressionText.length}`);
  toggleVisualisation(exprType, expressionText)
    .then(() => {
      const isNowVisualised = isExpressionVisualised(exprType);
      if (!wasVisualised && isNowVisualised) {
        ensureSerialVisPanelVisible();
      }
    })
    .catch((error) => {
      dbg(`Visualisation toggle failed for ${exprType}: ${error}`);
    });
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
    navigationMetaField,
    nodeHighlightField,
    lastEvaluatedExpressionField,
    expressionClearClickPlugin,
    expressionGutterField,
    expressionGutter
];

// console.log("[structure.mjs] nodeHighlightField:", nodeHighlightField);
// console.log("[structure.mjs] structureExtensions:", structureExtensions);
