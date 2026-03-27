import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Multi-line expression',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
  ],
  description: 'A single expression spanning multiple lines with indentation. Tests that the SVG polygon correctly follows the staircase shape of indented code.',
  editor: {
    editorContent: `(define my-synth
  (let ((freq 440)
        (amp 0.5)
        (mod (sine 2)))
    (* amp
       (sine (* freq
                (+ 1 (* 0.01 mod)))))))`,
    extensions: ['structure-highlight'],
    cursorPosition: 20, // inside the let binding
  },
});
