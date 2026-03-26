import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Cursor at document end',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Cursor positioned after the last closing paren. Tests that no highlight crashes or renders incorrectly when cursor is outside all forms.',
  editor: {
    editorContent: '(sine 440)\n(tri 220)',
    cursorPosition: 21, // after the final )
  },
});
