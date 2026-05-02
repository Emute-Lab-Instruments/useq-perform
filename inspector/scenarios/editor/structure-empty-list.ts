import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Empty list',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/adapter/decorations.ts',
    'src/editors/extensions/lezerHelpers.ts',
  ],
  description: 'Cursor inside an empty list (). Tests that the highlight handles zero-width content nodes gracefully.',
  editor: {
    editorContent: '(define x ())\n(define y (list 1 2))',
    extensions: ['structure-highlight'],
    cursorPosition: 11, // between the parens of ()
  },
});
