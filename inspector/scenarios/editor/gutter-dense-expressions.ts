import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Expression Gutter',
  name: 'Dense expression assignments',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/expressionHighlights.ts',
    'src/editors/extensions/expressionEval.ts',
  ],
  description:
    'Seven consecutive single-line assignments (a1-a4, d1-d3). Tests visual density when many gutter bars are stacked with no gaps.',
  editor: {
    editorContent: `a1 (sine 110)
a2 (sine 220)
a3 (sine 330)
a4 (sine 440)
d1 (> (phase 1) 0.5)
d2 (> (phase 2) 0.5)
d3 (> (phase 4) 0.5)`,
    extensions: ['gutter'],
  },
});
