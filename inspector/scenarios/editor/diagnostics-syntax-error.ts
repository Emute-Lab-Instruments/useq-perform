import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Diagnostics',
  name: 'Syntax error squiggles',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/diagnostics.ts',
  ],
  description: 'Diagnostic squiggly underlines for a syntax error — missing closing parenthesis.',
  editor: {
    editorContent: '(+ 1 2\n(* 3 4)',
  },
});
