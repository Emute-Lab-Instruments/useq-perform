import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Inline Results',
  name: 'Success and error results mixed',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/inlineResults.ts',
  ],
  description: 'Two expressions side by side: one with a normal result and one with an error result. Tests that success and error styling are visually distinct, with the error result appearing in red.',
  grepTerms: ['inlineResultsField', 'showInlineResult', 'InlineResultWidget', '.cm-inline-result', '.cm-inline-result-error'],
  editor: {
    editorContent: '(+ 1 2)\n(/ 1 0)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '3', pos: 7 },
      { text: 'Division by zero', pos: 15, isError: true },
    ],
  },
});
