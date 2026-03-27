import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Expression Gutter',
  name: 'All channel types visible',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/eval-integration.ts',
  ],
  description:
    'Analog, digital, and serial output assignments on separate lines. Verifies each channel type gets a distinct colored gutter bar.',
  editor: {
    editorContent: `a1 (sine 440)
a2 (sine 880)
d1 (> (phase 1) 0.5)
d2 (euclidean 8 3 (phase 2))
s1 (slow 2 (from-list (list 60 64 67) (step)))`,
    extensions: ['gutter'],
    evaluatedExpressions: [
      { expressionType: 'a1', position: { from: 0, to: 13, line: 1 } },
      { expressionType: 'a2', position: { from: 14, to: 27, line: 2 } },
      { expressionType: 'd1', position: { from: 28, to: 47, line: 3 } },
    ],
  },
});
