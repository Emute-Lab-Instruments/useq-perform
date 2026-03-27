import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Diagnostics',
  name: 'Clean code (no diagnostics)',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/diagnostics.ts',
  ],
  description: 'Syntactically and semantically valid code — verifies that no diagnostic squiggles appear on correct code.',
  editor: {
    editorContent: '(+ 1 2)\n(* 3 (- 10 4))\n(sin (/ 3.14 2))',
    extensions: ['diagnostics'],
  },
});
