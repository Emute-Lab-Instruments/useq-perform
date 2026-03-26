import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Themes',
  name: 'Dark vs light comparison',
  type: 'canary',
  sourceFiles: [
    'src/ui/styles/themes.css',
    'src/editors/themes.ts',
  ],
  description: 'Side-by-side comparison of dark and light editor themes with sample code.',
  editor: {
    editorContent: '(define lfo (sine 0.5))\n(tri (* lfo 200) 0.7)',
  },
  settings: {
    'editor.theme': 'dark',
  },
});
