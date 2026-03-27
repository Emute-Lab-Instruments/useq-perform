import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Inline Results',
  name: 'Result on multi-line expression',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/inlineResults.ts',
  ],
  description: 'A multi-line expression with the inline result appearing after the closing paren on the last line. The result widget should anchor to the end of the expression, not the first line.',
  grepTerms: ['inlineResultsField', 'showInlineResult', 'InlineResultWidget', '.cm-inline-result'],
  editor: {
    editorContent: '(+ 1\n   2\n   3)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '6', pos: 14 },
    ],
  },
});
