import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Diagnostics',
  name: 'Warning squiggles',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/diagnostics.ts',
  ],
  description: 'Warning-severity diagnostic squiggles — e.g., an unused variable binding that the interpreter flags.',
  editor: {
    editorContent: '(let ((unused-var 42))\n  (+ 1 2))',
  },
});
