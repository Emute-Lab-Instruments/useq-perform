// Expression evaluation tracking — side-effectful integration with transport.
// Handles detecting evaluated expressions, sending code to uSEQ, and
// coordinating with the visualisation subsystem.

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { Annotation, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

import { sendTouSEQ } from "../../../transport/json-protocol.ts";
import { isConnectedToModule } from "../../../transport/connector.ts";
import {
  isExpressionVisualised,
  toggleVisualisation,
  refreshVisualisedExpression,
  notifyExpressionEvaluated,
} from "../../../effects/visualisationSampler.ts";
import { showVisualisationPanel } from "../../../ui/adapters/visualisationPanel";
import { dbg } from "../../../lib/debug.ts";
import { getAppSettings } from "../../../runtime/appSettingsRepository.ts";

import { findNodeAt } from "./new-structure.ts";

// ---------------------------------------------------------------------------
// Shared regex — matches expression references like a1, d2, s3, etc.
// ---------------------------------------------------------------------------

/** Regex matching expression type references (e.g. `a1`, `d3`, `s2`). Uses the
 *  global flag, so always reset `lastIndex` before each scan. */
export const matchPattern = /\b([ads])([1-8])(?=[\s)(]|$)/g;

// ---------------------------------------------------------------------------
// Annotations & StateField
// ---------------------------------------------------------------------------

/** Annotation for expression evaluation events. */
export const expressionEvaluatedAnnotation = Annotation.define<{
  expressionType: string;
  position?: { from: number; to: number; line: number };
  clear?: boolean;
}>();

/** StateField tracking the last evaluated expression for each type. */
export const lastEvaluatedExpressionField = StateField.define<
  Map<string, { from: number; to: number; line: number }>
>({
  create() {
    return new Map();
  },
  update(value, tr) {
    const anns: any[] = (tr as any).annotations || [];
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
                line: meta.position.line,
              });
              updated = true;
            }
          }
        }
      }
      if (updated) return newMap;
    }
    return value;
  },
});

// ---------------------------------------------------------------------------
// Pure helpers for expression detection
// ---------------------------------------------------------------------------

/** Find expression boundaries by walking up the Lezer syntax tree. */
export function findExpressionBounds(
  state: EditorState,
  matchPos: number,
): { from: number; to: number; startPos: number; endPos: number } {
  const doc = state.doc;
  const tree = syntaxTree(state);
  const node = tree.resolveInner(matchPos, 1);

  let current: any = node;
  while (current && !["List", "Vector", "Map"].includes(current.name)) {
    current = current.parent;
  }

  if (current) {
    return {
      from: doc.lineAt(current.from).number,
      to: doc.lineAt(current.to).number,
      startPos: current.from,
      endPos: current.to,
    };
  }

  const line = doc.lineAt(matchPos);
  return {
    from: line.number,
    to: line.number,
    startPos: line.from,
    endPos: line.to,
  };
}

/** Pure: find expression at a cursor position within a line. */
export function findExpressionAtPosition(
  cursor: number,
  lineText: string,
  lineFrom: number,
  findBoundsFn: (pos: number) => { from: number; startPos: number; endPos: number },
): { expressionType: string; position: { from: number; to: number; line: number } } | null {
  let match: RegExpExecArray | null;
  matchPattern.lastIndex = 0;

  while ((match = matchPattern.exec(lineText)) !== null) {
    const matchStart = lineFrom + match.index;
    const bounds = findBoundsFn(matchStart);
    if (cursor >= bounds.startPos && cursor <= bounds.endPos) {
      return {
        expressionType: `${match[1]}${match[2]}`,
        position: {
          from: bounds.startPos,
          to: bounds.endPos,
          line: bounds.from,
        },
      };
    }
  }

  return null;
}

/** Pure: determine if a range is active based on last evaluation. */
export function isRangeActive(
  range: { from: number; to: number },
  lastEvaluated: { line: number } | null | undefined,
): boolean {
  if (!lastEvaluated) return false;
  return lastEvaluated.line >= range.from && lastEvaluated.line <= range.to;
}

/** Pure: find all expression ranges in document text. */
export function findExpressionRanges(
  docLines: Array<{ text: string; from: number }>,
  findBoundsFn: (pos: number) => { from: number; to: number },
  getColorFn: (match: RegExpExecArray) => string,
): Map<string, Array<{ color: string; from: number; to: number; matchStart: number }>> {
  const expressionRanges = new Map<
    string,
    Array<{ color: string; from: number; to: number; matchStart: number }>
  >();

  for (let lineNum = 1; lineNum <= docLines.length; lineNum++) {
    const lineText = docLines[lineNum - 1].text;
    const lineFrom = docLines[lineNum - 1].from;
    let match: RegExpExecArray | null;
    matchPattern.lastIndex = 0;

    while ((match = matchPattern.exec(lineText)) !== null) {
      const matchStart = lineFrom + match.index;
      const expressionType = `${match[1]}${match[2]}`;
      const color = getColorFn(match);
      const bounds = findBoundsFn(matchStart);

      if (!expressionRanges.has(expressionType)) {
        expressionRanges.set(expressionType, []);
      }
      expressionRanges.get(expressionType)!.push({
        color,
        from: bounds.from,
        to: bounds.to,
        matchStart,
      });
    }
  }

  return expressionRanges;
}

// ---------------------------------------------------------------------------
// Side-effectful helpers
// ---------------------------------------------------------------------------

/** Scan the document for the definition of an expression type. */
function findExpressionDefinition(
  view: EditorView,
  exprType: string,
): { expressionText: string; from: number; to: number } | null {
  const state = view.state;
  const doc = state.doc;

  dbg(`Finding definition for ${exprType}`);

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const lineObj = doc.line(lineNum);
    const lineText = lineObj.text;
    const lineFrom = lineObj.from;

    let match: RegExpExecArray | null;
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
        return { expressionText, from: startLineObj.from, to: endLineObj.to };
      }
    }
  }

  dbg(`No definition located for ${exprType}`);
  return null;
}

function ensureSerialVisPanelVisible(): void {
  showVisualisationPanel({ emitAutoOpenEvent: true });
}

// ---------------------------------------------------------------------------
// Public eval-integration API
// ---------------------------------------------------------------------------

/**
 * Detect the expression at the current cursor, dispatch evaluation annotations,
 * and refresh any active visualisations.
 */
export function detectAndTrackExpressionEvaluation(view: EditorView): void {
  const state = view.state;
  const doc = state.doc;
  const ui = (getAppSettings()?.ui as any) || {};
  if (ui.expressionLastTrackingEnabled === false) {
    return;
  }

  // Determine evaluated top-level range using standard syntax tree
  let evalFrom = 0;
  let evalTo = doc.length;
  const selection = state.selection.main;
  let node: any = findNodeAt(state, selection.from, selection.to);

  if (node) {
    while (node.parent && node.parent.type.name !== "Program") {
      node = node.parent;
    }
    if (node.parent && node.parent.type.name === "Program") {
      evalFrom = node.from;
      evalTo = node.to;
    }
  }

  if (evalFrom === evalTo) return;

  const startLineNum = doc.lineAt(evalFrom).number;
  const endLineNum = doc.lineAt(evalTo).number;
  const lastInChunk = new Map<
    string,
    {
      expressionType: string;
      position: { from: number; to: number; line: number };
      matchStart: number;
    }
  >();

  for (let lineNum = startLineNum; lineNum <= endLineNum; lineNum++) {
    const lineObj = doc.line(lineNum);
    const lineText = lineObj.text;
    const lineFrom = lineObj.from;
    let match: RegExpExecArray | null;
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
          line: bounds.from,
        },
        matchStart,
      };
      const prev = lastInChunk.get(exprType);
      if (!prev || prev.matchStart <= info.matchStart) {
        lastInChunk.set(exprType, info);
      }
    }
  }

  if (lastInChunk.size > 0) {
    const evaluations = Array.from(lastInChunk.values());
    const annotations = evaluations.map((info) =>
      expressionEvaluatedAnnotation.of({
        expressionType: info.expressionType,
        position: info.position,
      }),
    );
    view.dispatch({ annotations });

    for (const info of evaluations) {
      const exprType = info.expressionType;
      notifyExpressionEvaluated(exprType);

      if (!isExpressionVisualised(exprType)) continue;

      const definition = findExpressionDefinition(view, exprType);
      const newText = definition?.expressionText?.trim();
      if (!newText) continue;

      refreshVisualisedExpression(exprType, newText).catch((error: any) => {
        dbg(`Visualise: failed to refresh ${exprType} after evaluation: ${error}`);
      });
    }
  }
}

/** Send a neutral value for the given expression type and clear its active state. */
export function handleClearExpression(view: EditorView, exprType: string): void {
  if (!isConnectedToModule || !isConnectedToModule()) return;

  const type = exprType[0];
  const code = type === "a" ? `(${exprType} 0.5)` : `(${exprType} 0)`;
  try {
    sendTouSEQ(code);
  } catch (_e) {
    // ignore
  }
  view.dispatch({
    annotations: expressionEvaluatedAnnotation.of({
      expressionType: exprType,
      clear: true,
    }),
  });
}

/** Send the expression definition to the module and track evaluation. */
export function handlePlayExpression(view: EditorView, exprType: string): void {
  const definition = findExpressionDefinition(view, exprType);
  if (!definition) return;

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

/** Toggle visualisation for an expression. */
export function handleVisualiseExpression(
  view: EditorView,
  exprType: string,
  expressionTextOverride: string | null = null,
): void {
  let expressionText =
    typeof expressionTextOverride === "string"
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

  if (typeof console !== "undefined" && console.debug) {
    console.debug("useq:visualise-toggle", {
      exprType,
      wasVisualised,
      length: expressionText.length,
    });
  }
  dbg(`Visualise: toggling ${exprType}, text length ${expressionText.length}`);
  toggleVisualisation(exprType, expressionText)
    .then(() => {
      const isNowVisualised = isExpressionVisualised(exprType);
      if (!wasVisualised && isNowVisualised) {
        ensureSerialVisPanelVisible();
      }
    })
    .catch((error: any) => {
      dbg(`Visualisation toggle failed for ${exprType}: ${error}`);
    });
}
