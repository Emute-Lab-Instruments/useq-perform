// Expression evaluation tracking — side-effectful integration with transport.
// Handles detecting evaluated expressions, sending code to uSEQ, and
// coordinating with the visualisation subsystem.
//
// Pure state definitions (matchPattern, annotations, StateField, pure helpers)
// live in expressionEvalState.ts to avoid pulling runtime deps into the
// Inspector iframe.

import type { EditorView } from "@codemirror/view";

import {
  isExpressionVisualised,
  toggleVisualisation,
  registerVisualisation,
  refreshVisualisedExpression,
  notifyExpressionEvaluated,
} from "../../effects/visualisationSampler.ts";
import { showVisualisationPanel } from "../../ui/adapters/visualisationPanel";
import { dbg } from "../../lib/debug.ts";
import { getAppSettings } from "../../runtime/appSettingsRepository.ts";

import { findNodeAt } from "./lezerHelpers.ts";

// ---------------------------------------------------------------------------
// EvalIntegrationConfig — dependency injection interface
// ---------------------------------------------------------------------------

/**
 * Configuration for the eval-integration system.
 * Each field is a specific capability — no app-wide singletons imported directly.
 */
export interface EvalIntegrationConfig {
  /** Send code to the uSEQ module. Returns a promise that resolves when sent. */
  sendCode: (code: string) => Promise<any>;
  /** Check whether the module is currently connected. */
  isConnected: () => boolean;
}

// Module-level config instance — set via `setEvalIntegrationConfig()` or
// lazily initialised with `createDefaultEvalIntegrationConfig()` from the
// wiring module (expressionEvalDefaults.ts).
let _config: EvalIntegrationConfig | null = null;

/** Override the eval-integration config (e.g. for tests or Inspector). */
export function setEvalIntegrationConfig(config: EvalIntegrationConfig): void {
  _config = config;
}

/** Get the active config. Throws if not yet initialised. */
function getConfig(): EvalIntegrationConfig {
  if (!_config) {
    throw new Error(
      "EvalIntegrationConfig not initialised. " +
        "Call setEvalIntegrationConfig(createDefaultEvalIntegrationConfig()) during bootstrap.",
    );
  }
  return _config;
}

// Re-export everything from expressionEvalState.ts for backward compatibility.
export {
  matchPattern,
  expressionEvaluatedAnnotation,
  lastEvaluatedExpressionField,
  findExpressionBounds,
  findExpressionAtPosition,
  isRangeActive,
  findExpressionRanges,
} from "./expressionEvalState.ts";

import {
  matchPattern,
  expressionEvaluatedAnnotation,
  findExpressionBounds,
} from "./expressionEvalState.ts";

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
 *
 * `isPreview` (soft eval): the rail tracks "what is running on the module",
 * which a soft eval does not change (expression-gutter.md §2.4). When preview
 * is set we skip the rail-active annotation entirely so
 * `lastEvaluatedExpressionField` is untouched, but we still refresh
 * already-visualised expressions so the soft preview updates the vis trace.
 */
export function detectAndTrackExpressionEvaluation(
  view: EditorView,
  opts: { isPreview?: boolean } = {},
): void {
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

    // Soft eval is a WASM-only preview that does not commit to hardware, so it
    // must not move the rail-active state (expression-gutter.md §2.4). Only a
    // non-preview eval dispatches the annotation that updates
    // `lastEvaluatedExpressionField` (the field `isRangeActive` reads).
    if (!opts.isPreview) {
      const annotations = evaluations.map((info) =>
        expressionEvaluatedAnnotation.of({
          expressionType: info.expressionType,
          position: info.position,
        }),
      );
      view.dispatch({ annotations });
    }

    for (const info of evaluations) {
      const exprType = info.expressionType;
      notifyExpressionEvaluated(exprType);

      const position = { from: info.position.line, to: info.position.line };
      const definition = findExpressionDefinition(view, exprType);
      const newText = definition?.expressionText?.trim();
      if (!newText) continue;

      const alreadyVisualised = isExpressionVisualised(exprType, position);

      if (opts.isPreview) {
        // Soft eval is an inspection action — it must NOT flip the toggle
        // (expression-gutter.md §3.4). Only refresh an already-toggled variant
        // so the preview updates its trace.
        if (!alreadyVisualised) continue;
        refreshVisualisedExpression(exprType, newText, position).catch((error: any) => {
          dbg(`Visualise: failed to refresh ${exprType} after evaluation: ${error}`);
        });
        continue;
      }

      // Non-soft eval implicitly toggles vis on for the assigned output,
      // exclusive per output (expression-gutter.md §3.4, code-evaluation.md
      // §1.8). registerVisualisation keys by output name, so re-registering a1
      // replaces any prior a1 variant — that is the per-output exclusivity.
      if (alreadyVisualised) {
        refreshVisualisedExpression(exprType, newText, position).catch((error: any) => {
          dbg(`Visualise: failed to refresh ${exprType} after evaluation: ${error}`);
        });
      } else {
        registerVisualisation(exprType, newText, position).catch((error: any) => {
          dbg(`Visualise: failed to register ${exprType} after evaluation: ${error}`);
        });
      }
    }
  }
}

/** Send a neutral value for the given expression type and clear its active state. */
export function handleClearExpression(view: EditorView, exprType: string): void {
  const config = getConfig();
  if (!config.isConnected()) return;

  const type = exprType[0];
  const code = type === "a" ? `(${exprType} 0.5)` : `(${exprType} 0)`;
  try {
    config.sendCode(code);
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
  const config = getConfig();
  const connected = config.isConnected();

  if (connected) {
    try {
      dbg(`Play: sending ${exprType}`);
      config.sendCode(expressionText);
    } catch (e) {
      dbg(`Play: failed to send ${exprType}: ${e}`);
    }
  }

  const bounds = findExpressionDefinitionBounds(view, exprType);
  const position = bounds ? { from: bounds.from, to: bounds.to } : undefined;
  handleVisualiseExpression(view, exprType, expressionText, position);
}

/**
 * Toggle vis for the top-level form at the current structural halo position
 * (expression-gutter.md §4.1, `vis.toggleAtHalo`). Resolves the output
 * assignment at the head of the enclosing top-level form; if the form is not a
 * recognised output assignment the action is a no-op (§4.2).
 *
 * Returns true when a toggle was performed, false when there was no recognised
 * output form at the halo.
 */
export function handleToggleVisAtHalo(view: EditorView): boolean {
  const state = view.state;
  const doc = state.doc;
  const pos = state.selection.main.from;

  // Resolve the enclosing top-level form via the syntax tree.
  let node: any = findNodeAt(state, pos, pos);
  if (!node) return false;
  while (node.parent && node.parent.type.name !== "Program") {
    node = node.parent;
  }
  if (!(node.parent && node.parent.type.name === "Program")) return false;

  const formFrom = node.from;
  const formTo = node.to;

  // Find the output assignment at the head of this form. matchPattern is broad,
  // so we require the matched token to sit at (or right after) the form's
  // opening — i.e. the head position of the list (§1.4: only output
  // assignments get a rail/toggle).
  const startLineNum = doc.lineAt(formFrom).number;
  const endLineNum = doc.lineAt(formTo).number;
  for (let lineNum = startLineNum; lineNum <= endLineNum; lineNum++) {
    const lineObj = doc.line(lineNum);
    const lineText = lineObj.text;
    const lineFrom = lineObj.from;
    let match: RegExpExecArray | null;
    matchPattern.lastIndex = 0;
    while ((match = matchPattern.exec(lineText)) !== null) {
      const matchStart = lineFrom + match.index;
      if (matchStart < formFrom || matchStart > formTo) continue;
      // Head position: the char before the token (skipping inner whitespace)
      // must be the form's opening paren.
      const before = doc.sliceString(formFrom, matchStart);
      if (!/^\(\s*$/.test(before)) continue;
      const exprType = `${match[1]}${match[2]}`;
      const expressionText = doc.sliceString(formFrom, formTo).trim();
      const position = { from: formFrom, to: formTo };
      handleVisualiseExpression(view, exprType, expressionText, position);
      return true;
    }
  }
  return false;
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
