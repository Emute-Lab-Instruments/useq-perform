import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Preview mode (cyan flash)',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
  ],
  description: 'When code is evaluated in WASM-only preview mode (no device connected), the expression receives a cyan/blue background flash (cm-evaluated-code cm-evaluated-preview decoration) instead of the yellow connected-mode flash. The entire nested expression should show the cyan highlight.',
  editor: {
    editorContent: '(+ (* 2 3) (- 10 5))',
    extensions: ['eval-highlight'],
    cursorPosition: 1,
    evalHighlight: { from: 0, to: 20, isPreview: true }, // cyan flash
  },
});
