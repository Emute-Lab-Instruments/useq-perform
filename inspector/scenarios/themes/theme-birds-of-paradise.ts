import { defineScenario } from '../../framework/scenario';

const sampleCode = `; ModuLisp sample for theme comparison
(define lfo (sine 0.25))
(define env (ar 0.01 0.3))

a1 (sine (* 55 (+ 1 (* lfo 0.5))))
a2 (* env (tri 110))

d1 (> (phase 2) 0.5)

; string and number literals
(define name "useq")
(define pi 3.14159)`;

export default defineScenario({
  category: 'Themes',
  name: 'Birds of Paradise',
  type: 'contract',
  sourceFiles: ['src/editors/themes.ts'],
  editor: {
    editorContent: sampleCode,
  },
  settings: {
    'editor.theme': 'Birds of Paradise',
  },
});
