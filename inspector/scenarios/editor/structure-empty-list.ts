import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Empty list',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Cursor inside an empty list (). Tests that the highlight handles zero-width content nodes gracefully.',
  editor: {
    editorContent: '(define x ())\n(define y (list 1 2))',
    cursorPosition: 11, // between the parens of ()
  },
});
