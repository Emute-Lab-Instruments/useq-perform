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
    extensions: ['diagnostics'],
    diagnostics: [
      { start: 0, end: 7, severity: 'error', message: 'Unmatched opening parenthesis', suggestion: 'Add a closing ) to match the opening ( at position 0' },
    ],
  },
});
