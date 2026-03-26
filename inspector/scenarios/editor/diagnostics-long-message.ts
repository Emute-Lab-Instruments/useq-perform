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
  },
});
