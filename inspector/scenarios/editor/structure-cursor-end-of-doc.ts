import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Cursor at document end',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/adapter/decorations.ts',
    'src/editors/extensions/lezerHelpers.ts',
  ],
  description: 'Cursor positioned after the last closing paren. Tests that no highlight crashes or renders incorrectly when cursor is outside all forms.',
  editor: {
    editorContent: '(sine 440)\n(tri 220)',
    extensions: ['structure-highlight'],
    cursorPosition: 20, // after the final )
  },
});
