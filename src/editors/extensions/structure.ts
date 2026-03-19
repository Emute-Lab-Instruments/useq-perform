// Barrel re-export for structure extensions.
// The implementation is split across:
//   structure/ast.ts            — pure AST navigation helpers
//   structure/eval-integration.ts — expression evaluation tracking & transport side-effects
//   structure/decorations.ts    — CodeMirror decorations, gutter markers, view plugins

import { navigationMetaField } from "./structure/ast.ts";
import {
  lastEvaluatedExpressionField,
} from "./structure/eval-integration.ts";
import {
  nodeHighlightField,
  expressionClearClickPlugin,
  expressionGutterField,
  expressionGutter,
} from "./structure/decorations.ts";

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
} from "./structure/eval-integration.ts";

// --- Decorations ---
export {
  settingsChangedAnnotation,
  nodeHighlightField,
  getCurrentPalette,
  getMatchColor,
  ExpressionGutterMarker,
  createMarkersForRange,
  processExpressionRanges,
  expressionGutter,
  expressionGutterField,
  expressionClearClickPlugin,
} from "./structure/decorations.ts";

// --- Bundled extension array ---
export const structureExtensions = [
  navigationMetaField,
  nodeHighlightField,
  lastEvaluatedExpressionField,
  expressionClearClickPlugin,
  expressionGutterField,
  expressionGutter,
];
