import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Disconnected mode (gray flash)',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
    'src/transport/serial-utils.ts',
    'src/ui/styles/editor.css',
    'src/ui/styles/base.css',
  ],
  description:
    'When no device is connected, the eval flash is gray instead of yellow. The CSS variable --code-eval-highlight-color is set to the disconnected value. Compare with the connected (yellow) scenario to verify the color difference. Watch for the repeating gray flash.',
  grepTerms: [
    'flashEvalHighlight',
    'setEvalHighlightColor',
    '.cm-evaluated-code',
    '--code-eval-highlight-color-disconnected',
    '--code-eval-highlight-color',
  ],
  cssVariables: {
    '--code-eval-highlight-color': 'rgb(148, 148, 148)',
  },
  editor: {
    loadAppStyles: true,
    editorContent: '(sine 440)\n(tri 220)',
    extensions: ['eval-highlight'],
    cursorPosition: 1,
    evalHighlight: { from: 0, to: 10 },
    evalHighlightIntervalMs: 2500,
  },
});
