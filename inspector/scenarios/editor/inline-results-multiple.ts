import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Inline Results',
  name: 'Multiple inline results',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/inlineResults.ts',
  ],
  description: 'Three expressions on separate lines, each with its own inline result widget. Tests that multiple results stack vertically without overlapping or misalignment.',
  grepTerms: ['inlineResultsField', 'showInlineResult', 'InlineResultWidget', '.cm-inline-result'],
  editor: {
    editorContent: '(+ 1 2)\n(* 3 4)\n(- 10 5)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '3', pos: 7 },
      { text: '12', pos: 15 },
      { text: '5', pos: 23 },
    ],
  },
});
