import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Structure Highlights',
  name: 'Real uSEQ patch',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/structure/decorations.ts',
    'src/editors/extensions/structure/eval-integration.ts',
  ],
  description: 'A realistic uSEQ patch with output assignments (a1, d1, s1), modulation, and typical patterns. Tests highlight rendering on production-like code.',
  editor: {
    editorContent: `; FM bass with envelope
(define lfo (sine 0.25))
(define env (ar 0.01 0.3))

a1 (sine (* 55 (+ 1 (* lfo 0.5))))
a2 (* env (sine 110))

d1 (> (phase 2) 0.5)
d2 (euclidean 8 5 (phase 4))

s1 (slow 4
  (from-list
    (list 60 63 67 72)
    (step)))`,
    extensions: ['structure-highlight'],
    cursorPosition: 75, // inside the a1 sine expression
  },
});
