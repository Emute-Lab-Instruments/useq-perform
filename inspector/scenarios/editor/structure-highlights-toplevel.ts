import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Top-level forms',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/structure.ts',
    'src/editors/extensions/structure/decorations.ts',
  ],
  description: 'Three top-level forms with cursor at the opening paren of the first. The entire first (define ...) should be highlighted as a top-level program node.',
  editor: {
    editorContent: '(define freq 440)\n(define amp 0.5)\n(sine freq amp)',
    cursorPosition: 0, // at the opening ( of first form
  },
});
