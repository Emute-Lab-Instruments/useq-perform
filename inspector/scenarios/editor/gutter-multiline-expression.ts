import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Expression Gutter',
  name: 'Multiline expression assignment',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/eval-integration.ts',
  ],
  description:
    'An expression assignment spanning multiple lines. Tests that the gutter bar extends across all lines of the expression with start, mid, and end segments.',
  editor: {
    editorContent: `a1 (slow 4
  (sine
    (* 110 (+ 1 (sine 0.5)))))`,
    extensions: ['gutter'],
  },
});
