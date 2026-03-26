import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Probes',
  name: 'Single probe',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/probes.ts',
    'src/editors/extensions/probeHelpers.ts',
  ],
  description: 'A single probe oscilloscope widget displaying a sine waveform after an expression.',
  editor: {
    editorContent: '(sine 440) ;probe',
    extensions: ['probes'],
  },
});
