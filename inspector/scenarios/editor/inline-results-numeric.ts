import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Inline Results',
  name: 'Numeric result',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/inlineResults.ts',
  ],
  description: 'Inline result widget showing a numeric evaluation result after an expression.',
  editor: {
    editorContent: '(+ 1 2) ;=> 3',
  },
});
