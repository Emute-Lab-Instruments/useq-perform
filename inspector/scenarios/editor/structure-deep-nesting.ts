import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Deep nesting (5 levels)',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Five levels of nesting with cursor at the innermost expression. Tests that both the current node polygon and parent dashed line render correctly at extreme depth.',
  editor: {
    editorContent: '(a (b (c (d (e 42)))))',
    extensions: ['structure-highlight'],
    cursorPosition: 15, // on the 42 inside (e 42)
  },
});
