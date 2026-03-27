import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Expression Gutter',
  name: 'No expression assignments',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/eval-integration.ts',
  ],
  description:
    'Code with no output assignments (a1-a4, d1-d3, s1-s8). Verifies the expression gutter is empty when no patterns match.',
  editor: {
    editorContent: `(define x 10)
(+ x 5)`,
    extensions: ['gutter'],
  },
});
