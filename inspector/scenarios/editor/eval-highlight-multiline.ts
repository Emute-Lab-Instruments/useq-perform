import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Multi-line expression flash',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
  ],
  description: 'When the cursor is inside a multi-line top-level form, the eval highlight flash should cover the entire form across all lines, not just the line containing the cursor. The decoration range should span from the opening paren of (define ...) to its closing paren.',
  editor: {
    editorContent: '(define synth\n  (let ((f 440))\n    (sine f)))',
    cursorPosition: 28, // inside the let body
  },
});
