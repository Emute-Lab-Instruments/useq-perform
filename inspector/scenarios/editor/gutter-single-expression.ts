import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Expression Gutter',
  name: 'Single expression assignment',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/eval-integration.ts',
  ],
  description:
    'A single analog output assignment. Verifies the gutter renders a colored vertical bar and play button for one expression.',
  editor: {
    editorContent: 'a1 (sine 440)',
    extensions: ['gutter'],
  },
});
