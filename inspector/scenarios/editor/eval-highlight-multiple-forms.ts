import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Multiple top-level forms',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
    'src/ui/styles/editor.css',
  ],
  description:
    'Only the form containing the cursor flashes — other forms remain unhighlighted. The cursor is in (tri 220), so only that form flashes. Watch the repeating animation to confirm the other two forms stay untouched.',
  grepTerms: ['flashEvalHighlight', '.cm-evaluated-code', 'getTopLevelRange'],
  editor: {
    loadAppStyles: true,
    editorContent: '(sine 440)\n(tri 220)\n(saw 110)',
    extensions: ['eval-highlight'],
    cursorPosition: 14,
    evalHighlight: { from: 11, to: 20 },
    evalHighlightIntervalMs: 2500,
  },
});
