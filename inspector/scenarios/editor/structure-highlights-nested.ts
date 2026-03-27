import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Nested expressions',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure.ts',
    'src/editors/extensions/structure/decorations.ts',
  ],
  description: 'Cursor inside an inner form of a nested arithmetic expression. The inner (* 2 3) should be highlighted with the parent (+ ...) dashed line visible below.',
  editor: {
    editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
    extensions: ['structure-highlight'],
    cursorPosition: 4, // inside (* 2 3)
  },
});
