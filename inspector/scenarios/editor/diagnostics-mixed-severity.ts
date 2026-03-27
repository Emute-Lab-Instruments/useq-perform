import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Diagnostics',
  name: 'Mixed severity levels',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/diagnostics.ts',
  ],
  description: 'Code triggering error, warning, and info diagnostics on different lines. Tests color differentiation between severity levels.',
  editor: {
    editorContent: '(+ 1 (bad-syntax\n(let ((unused 0)) (+ 1 2))\n(* 3 3)',
    extensions: ['diagnostics'],
    diagnostics: [
      { start: 5, end: 16, severity: 'error', message: 'Unmatched opening parenthesis' },
      { start: 23, end: 29, severity: 'warning', message: 'Unused variable: unused' },
      { start: 43, end: 48, severity: 'info', message: 'Expression always evaluates to 9' },
    ],
  },
});
