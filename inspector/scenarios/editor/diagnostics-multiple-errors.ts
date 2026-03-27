import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Diagnostics',
  name: 'Multiple errors stacked',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/diagnostics.ts',
  ],
  description: 'Three distinct errors on separate lines — missing closing paren, unknown function, and mismatched types. Tests visual stacking of multiple error squiggles.',
  editor: {
    editorContent: '(+ 1 (missing-paren 3\n(nonexistent-fn 7)\n(+ "text" 5)',
    extensions: ['diagnostics'],
  },
});
