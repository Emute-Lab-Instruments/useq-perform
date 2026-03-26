import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Cursor at paren boundary',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Cursor positioned right at a closing paren followed by an opening paren — tests which node gets highlighted at the )(  boundary.',
  editor: {
    editorContent: '(+ 1 2)(* 3 4)',
    cursorPosition: 7, // right at the ( of (* 3 4)
  },
});
