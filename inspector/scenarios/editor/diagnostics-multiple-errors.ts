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
    diagnostics: [
      { start: 5, end: 21, severity: 'error', message: 'Unmatched opening parenthesis' },
      { start: 22, end: 36, severity: 'error', message: 'Unknown function: nonexistent-fn' },
      { start: 43, end: 49, severity: 'error', message: 'Type mismatch: expected number, got string' },
    ],
  },
});
