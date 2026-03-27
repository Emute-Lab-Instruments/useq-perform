import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Inline Results',
  name: 'Numeric result',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/inlineResults.ts',
  ],
  description: 'Inline result widget showing a numeric evaluation result after an expression. The ;=> 3 annotation should appear as a styled widget, not as plain text.',
  editor: {
    editorContent: '(+ 1 2)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '3', pos: 7 },
    ],
  },
});
