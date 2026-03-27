import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Diagnostics',
  name: 'Long diagnostic with suggestion',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/diagnostics.ts',
  ],
  description: 'Code triggering a diagnostic whose message includes a suggestion and example — tests text wrapping behavior in the tooltip overlay.',
  editor: {
    editorContent: '(setq undefined-output 42)',
    extensions: ['diagnostics'],
    diagnostics: [
      {
        start: 1, end: 5, severity: 'error',
        message: 'Unknown function: setq',
        suggestion: 'Did you mean "set!"? Use (set! variable value) to mutate a binding.',
        example: '(set! my-var 42)',
      },
    ],
  },
});
