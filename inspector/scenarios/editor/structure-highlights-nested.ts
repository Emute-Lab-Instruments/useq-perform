import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Nested expressions',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure.ts',
    'src/editors/extensions/structure/decorations.ts',
  ],
  description: 'Verifies structure highlighting on deeply nested s-expressions with cursor inside an inner form.',
  editor: {
    editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
    cursorPosition: 4,
  },
  settings: {
    'editor.structureHighlights': true,
  },
});
