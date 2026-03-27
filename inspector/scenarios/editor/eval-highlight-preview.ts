import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Preview mode (cyan flash)',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
    'src/ui/styles/editor.css',
    'src/ui/styles/base.css',
  ],
  description:
    'WASM-only preview mode: no device connected, code evaluated locally. The expression gets a cyan/blue flash (cm-evaluated-preview) instead of yellow. Watch for the repeating cyan flash.',
  grepTerms: [
    'evalHighlightField',
    'flashEvalHighlight',
    '.cm-evaluated-preview',
    'flash-highlight-preview',
    '--code-eval-highlight-color-preview',
  ],
  editor: {
    loadAppStyles: true,
    editorContent: '(+ (* 2 3) (- 10 5))',
    extensions: ['eval-highlight'],
    cursorPosition: 1,
    evalHighlight: { from: 0, to: 20, isPreview: true },
    evalHighlightIntervalMs: 2500,
  },
});
