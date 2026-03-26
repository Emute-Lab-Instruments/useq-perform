import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Top-level forms',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/structure.ts',
    'src/editors/extensions/structure/decorations.ts',
  ],
  description: 'Verifies structure highlighting on multiple top-level forms with cursor at the start.',
  editor: {
    editorContent: '(define freq 440)\n(define amp 0.5)\n(sine freq amp)',
    cursorPosition: 0,
  },
  settings: {
    'editor.structureHighlights': true,
  },
});
