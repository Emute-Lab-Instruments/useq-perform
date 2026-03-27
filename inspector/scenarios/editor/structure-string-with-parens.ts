import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'String containing parentheses',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Code with string literals that contain parentheses. Tests that the AST correctly treats string contents as atoms and the highlight does not break on unmatched parens inside strings.',
  editor: {
    editorContent: '(define msg "hello (world)")\n(print msg)',
    extensions: ['structure-highlight'],
    cursorPosition: 15, // inside the string literal
  },
});
