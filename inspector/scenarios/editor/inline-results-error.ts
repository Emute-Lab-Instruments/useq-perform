import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Inline Results',
  name: 'Error result',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/inlineResults.ts',
  ],
  description: 'Inline result widget showing an error evaluation result. The ;=> Division by zero annotation should appear in red/error styling, distinct from normal result styling.',
  grepTerms: ['inlineResultsField', 'showInlineResult', 'InlineResultWidget', '.cm-inline-result', '.cm-inline-result-error'],
  editor: {
    editorContent: '(/ 1 0)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: 'Division by zero', pos: 6, isError: true },
    ],
  },
});
