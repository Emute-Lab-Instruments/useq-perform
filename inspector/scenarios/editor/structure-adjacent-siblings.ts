import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Adjacent sibling forms',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/ast.ts',
  ],
  description: 'Multiple sibling expressions inside a parent form, cursor on the middle one. Tests that exactly the right sibling is highlighted and the parent line shows correctly.',
  editor: {
    editorContent: '(+ (sine 440) (tri 220) (saw 110))',
    cursorPosition: 18, // inside (tri 220)
  },
});
