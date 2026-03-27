import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Staircase indentation',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
  ],
  description: 'Multi-line code with varying indentation levels. The SVG polygon should form a staircase shape that hugs the text content of each line rather than spanning the full width.',
  editor: {
    editorContent: `(if (> x 10)
  (begin
    (set! a 1)
    (set! b 2)
    (set! c 3))
  (begin
    (set! a 0)
    (set! b 0)))`,
    extensions: ['structure-highlight'],
    cursorPosition: 16, // inside the (begin on line 2
  },
});
