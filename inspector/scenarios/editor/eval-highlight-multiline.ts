import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Multi-line expression flash',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
    'src/ui/styles/editor.css',
  ],
  description:
    'The eval highlight flash covers an entire multi-line form, not just the cursor line. The decoration spans from the opening paren of (define ...) to its closing paren across all 3 lines. Watch for the repeating flash.',
  grepTerms: ['flashEvalHighlight', '.cm-evaluated-code', 'flash-highlight'],
  editor: {
    loadAppStyles: true,
    editorContent: '(define synth\n  (let ((f 440))\n    (sine f)))',
    extensions: ['eval-highlight'],
    cursorPosition: 28,
    evalHighlight: { from: 0, to: 42 },
    evalHighlightIntervalMs: 2500,
  },
});
