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
  },
});
