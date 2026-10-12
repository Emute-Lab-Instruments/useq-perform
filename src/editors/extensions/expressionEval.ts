// Expression evaluation tracking — side-effectful integration with transport.
// Handles detecting evaluated expressions, sending code to uSEQ, and
// coordinating with the visualisation subsystem.
//
// Pure state definitions (matchPattern, annotations, StateField, pure helpers)
// live in expressionEvalState.ts to avoid pulling runtime deps into the
// Storybook canvas.

import type { EditorView } from "@codemirror/view";

import { visualisationSession } from "../../effects/visualisationSession.ts";
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

/** Override the eval-integration config (e.g. for tests or Storybook). */
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

import {
  collectOutputAssignments,
  expressionEvaluatedAnnotation,
} from "./expressionEvalState.ts";

// ---------------------------------------------------------------------------
// Side-effectful helpers
// ---------------------------------------------------------------------------

/** Resolve one output variant using exact source offsets. */
function findExpressionDefinition(
  view: EditorView,
  exprType: string,
  position?: { from: number; to: number },
) {
  const assignment = collectOutputAssignments(view.state).find((entry) =>
    entry.expressionType === exprType &&
    (!position || (entry.from === position.from && entry.to === position.to)),
  );
  return assignment ? {
    ...assignment,
    expressionText: view.state.sliceDoc(assignment.from, assignment.to),
  } : null;
}

function ensureSerialVisPanelVisible(): void {
  showVisualisationPanel();
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

  const lastInChunk = new Map<string, {
    expressionType: string;
    position: { from: number; to: number; line: number };
  }>();
  for (const assignment of collectOutputAssignments(state)) {
    if (assignment.from < evalFrom || assignment.to > evalTo) continue;
    lastInChunk.set(assignment.expressionType, {
      expressionType: assignment.expressionType,
      position: { from: assignment.from, to: assignment.to, line: assignment.line },
    });
  }

  if (lastInChunk.size > 0) {
    const evaluations = Array.from(lastInChunk.values());

    // Soft eval is a WASM-only preview that does not commit to hardware, so it
    // must not move the rail-active state (expression-gutter.md §2.4). Only a
    // non-preview eval dispatches the annotation that updates
    // `lastEvaluatedExpressionField` (the field `isRangeActive` reads).
    if (!opts.isPreview && ui.expressionLastTrackingEnabled !== false) {
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
      visualisationSession.expressions.notifyEvaluated(exprType);

      const position = { from: info.position.from, to: info.position.to };
      const definition = findExpressionDefinition(view, exprType, position);
      const newText = definition?.expressionText?.trim();
      if (!newText) continue;

      const alreadyVisualised = visualisationSession.expressions.isVisualised(exprType, position);

      if (opts.isPreview) {
        // Soft eval is an inspection action — it must NOT flip the toggle
        // (expression-gutter.md §3.4). Only refresh an already-toggled variant
        // so the preview updates its trace.
        if (!alreadyVisualised) continue;
        visualisationSession.expressions.refresh(exprType, newText, position).catch((error: any) => {
          dbg(`Visualise: failed to refresh ${exprType} after evaluation: ${error}`);
        });
        continue;
      }

      // Non-soft eval implicitly toggles vis on for the assigned output,
      // exclusive per output (expression-gutter.md §3.4, code-evaluation.md
      // §1.8). registerVisualisation keys by output name, so re-registering a1
      // replaces any prior a1 variant — that is the per-output exclusivity.
      if (alreadyVisualised) {
        visualisationSession.expressions.refresh(exprType, newText, position).catch((error: any) => {
          dbg(`Visualise: failed to refresh ${exprType} after evaluation: ${error}`);
        });
      } else {
        visualisationSession.expressions.register(exprType, newText, position).catch((error: any) => {
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

/** Toggle only the clicked visualization variant; hardware eval is a separate action. */
export function handlePlayExpression(
  view: EditorView,
  exprType: string,
  position?: { from: number; to: number },
): void {
  const definition = findExpressionDefinition(view, exprType, position);
  if (!definition) return;
  handleVisualiseExpression(view, exprType, definition.expressionText, {
    from: definition.from,
    to: definition.to,
  });
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

  const assignments = collectOutputAssignments(state).filter(
    (entry) => entry.from === node.from && entry.to === node.to,
  );
  for (const assignment of assignments) {
    handleVisualiseExpression(view, assignment.expressionType,
      doc.sliceString(assignment.from, assignment.to),
      { from: assignment.from, to: assignment.to });
  }
  return assignments.length > 0;
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
      position = { from: definition.from, to: definition.to };
    }
  }

  if (!expressionText) {
    dbg(`Visualise: empty expression for ${exprType}`);
    return;
  }

  const wasVisualised = visualisationSession.expressions.isVisualised(exprType, position);

  dbg(`Visualise: toggling ${exprType}, text length ${expressionText.length}`);
  visualisationSession.expressions.toggle(exprType, expressionText, position)
    .then(() => {
      const isNowVisualised = visualisationSession.expressions.isVisualised(exprType, position);
      if (!wasVisualised && isNowVisualised) {
        ensureSerialVisPanelVisible();
      }
    })
    .catch((error: any) => {
      dbg(`Visualisation toggle failed for ${exprType}: ${error}`);
    });
}
