import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Expression Gutter',
  name: 'Single expression assignment',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/expressionHighlights.ts',
    'src/editors/extensions/expressionEval.ts',
  ],
  description:
    'A single analog output assignment. Verifies the gutter renders a colored vertical bar and play button for one expression.',
  grepTerms: ['ExpressionGutterMarker', 'expressionGutterField', 'createExpressionGutter', 'GutterConfig', '.cm-expression-gutter', '.cm-expr-play-btn'],
  editor: {
    editorContent: 'a1 (sine 440)',
    extensions: ['gutter'],
    evaluatedExpressions: [
      { expressionType: 'a1', position: { from: 0, to: 14, line: 1 } },
    ],
  },
});
