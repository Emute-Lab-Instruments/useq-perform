import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Bare atom (no wrapping parens)',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Cursor on a bare symbol that is not wrapped in parentheses. Tests that the highlight handles non-list nodes at the top level.',
  editor: {
    editorContent: 'freq\n(sine freq 0.5)',
    extensions: ['structure-highlight'],
    cursorPosition: 2, // on the bare 'freq' symbol
  },
});
