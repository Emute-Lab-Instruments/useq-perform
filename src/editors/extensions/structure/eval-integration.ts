// Expression evaluation tracking — side-effectful integration with transport.
// Handles detecting evaluated expressions, sending code to uSEQ, and
// coordinating with the visualisation subsystem.
//
// Pure state definitions (matchPattern, annotations, StateField, pure helpers)
// live in eval-state.ts to avoid pulling runtime deps into the Inspector iframe.

import type { EditorView } from "@codemirror/view";

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

// Re-export everything from eval-state.ts for backward compatibility.
// Existing code that imports from eval-integration.ts continues to work.
export {
  matchPattern,
  expressionEvaluatedAnnotation,
  lastEvaluatedExpressionField,
  findExpressionBounds,
  findExpressionAtPosition,
  isRangeActive,
  findExpressionRanges,
} from "./eval-state.ts";

import {
  matchPattern,
  expressionEvaluatedAnnotation,
  findExpressionBounds,
} from "./eval-state.ts";

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

/** Find expression bounds by line number (helper for visualise). */
function findExpressionDefinitionBounds(
  view: EditorView,
  exprType: string,
): { from: number; to: number } | null {
  const state = view.state;
  const doc = state.doc;

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
        return { from: bounds.from, to: bounds.to };
      }
    }
  }
  return null;
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

      const position = { from: info.position.line, to: info.position.line };
      if (!isExpressionVisualised(exprType, position)) continue;

      const definition = findExpressionDefinition(view, exprType);
      const newText = definition?.expressionText?.trim();
      if (!newText) continue;

      refreshVisualisedExpression(exprType, newText, position).catch((error: any) => {
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

  const bounds = findExpressionDefinitionBounds(view, exprType);
  const position = bounds ? { from: bounds.from, to: bounds.to } : undefined;
  handleVisualiseExpression(view, exprType, expressionText, position);
}

/** Toggle visualisation for an expression. */
export function handleVisualiseExpression(
  view: EditorView,
  exprType: string,
  expressionTextOverride: string | null = null,
  positionOverride?: { from: number; to: number },
): void {
  let expressionText =
    typeof expressionTextOverride === "string"
      ? expressionTextOverride.trim()
      : expressionTextOverride;
  let position = positionOverride;

  if (!expressionText || !position) {
    const definition = findExpressionDefinition(view, exprType);
    if (!definition) {
      dbg(`Visualise: could not find definition for ${exprType}`);
      return;
    }
    expressionText = definition.expressionText.trim();
    if (!position) {
      const bounds = findExpressionDefinitionBounds(view, exprType);
      if (bounds) {
        position = { from: bounds.from, to: bounds.to };
      }
    }
  }

  if (!expressionText) {
    dbg(`Visualise: empty expression for ${exprType}`);
    return;
  }

  const wasVisualised = isExpressionVisualised(exprType, position);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("useq:visualise-toggle", {
      exprType,
      wasVisualised,
      length: expressionText.length,
    });
  }
  dbg(`Visualise: toggling ${exprType}, text length ${expressionText.length}`);
  toggleVisualisation(exprType, expressionText, position)
    .then(() => {
      const isNowVisualised = isExpressionVisualised(exprType, position);
      if (!wasVisualised && isNowVisualised) {
        ensureSerialVisPanelVisible();
      }
    })
    .catch((error: any) => {
      dbg(`Visualisation toggle failed for ${exprType}: ${error}`);
    });
}
