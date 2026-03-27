import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Multiple top-level forms',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
  ],
  description: 'With multiple top-level expressions in the editor, only the form containing the cursor should receive the eval highlight flash. The other forms must remain unhighlighted. Here the cursor is in the second form (tri 220), so only that form should flash.',
  editor: {
    editorContent: '(sine 440)\n(tri 220)\n(saw 110)',
    extensions: ['eval-highlight'],
    cursorPosition: 14,
    evalHighlight: { from: 11, to: 20 }, // flash only (tri 220)
  },
});
