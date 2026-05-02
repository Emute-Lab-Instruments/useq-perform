// Barrel re-export for structure extensions.
// The implementation is split across:
//   structure/ast.ts            — pure AST navigation helpers
//   structure/eval-integration.ts — expression evaluation tracking (transport-free)
//   structure/eval-integration-defaults.ts — default config wiring (imports transport)
//   structure/decorations.ts    — CodeMirror decorations, gutter markers, view plugins

import { navigationMetaField } from "./structure/ast.ts";
import {
  lastEvaluatedExpressionField,
  setEvalIntegrationConfig,
} from "./structure/eval-integration.ts";
import { createDefaultEvalIntegrationConfig } from "./structure/eval-integration-defaults.ts";
import {
  nodeHighlightPlugin,
  createExpressionGutter,
  createDefaultGutterConfig,
} from "./structure/decorations.ts";

// Wire the default eval-integration config on module load (production wiring).
setEvalIntegrationConfig(createDefaultEvalIntegrationConfig());

// --- AST / navigation ---
export {
  findNodeAt,
  navigationMetaField,
  navigationMetaEffect,
  navigateIn,
  navigateOut,
  navigateNext,
  navigatePrev,
  navigateRight,
  navigateLeft,
  navigateUp,
  navigateDown,
  isStructuralToken,
  isContainerNode,
  isOperatorNode,
  getTrimmedRange,
  getContainerNodeAt,
  performNavigation,
} from "./structure/ast.ts";

// --- Eval integration ---
export {
  matchPattern,
  expressionEvaluatedAnnotation,
  lastEvaluatedExpressionField,
  findExpressionBounds,
  findExpressionAtPosition,
  isRangeActive,
  findExpressionRanges,
  detectAndTrackExpressionEvaluation,
  handleClearExpression,
  handlePlayExpression,
  handleVisualiseExpression,
  setEvalIntegrationConfig,
} from "./structure/eval-integration.ts";
export type { EvalIntegrationConfig } from "./structure/eval-integration.ts";
export { createDefaultEvalIntegrationConfig } from "./structure/eval-integration-defaults.ts";

// --- Decorations ---
export {
  settingsChangedAnnotation,
  nodeHighlightPlugin,
  getCurrentPalette,
  getMatchColor,
  ExpressionGutterMarker,
  createMarkersForRange,
  processExpressionRanges,
  createExpressionGutter,
  createDefaultGutterConfig,
} from "./structure/decorations.ts";
export type { GutterConfig } from "./structure/decorations.ts";

// --- Bundled extension array ---
export const structureExtensions = [
  navigationMetaField,
  nodeHighlightPlugin,
  lastEvaluatedExpressionField,
  ...createExpressionGutter(createDefaultGutterConfig()),
];
