import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Probes',
  name: 'Waveform probe',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/probes.ts',
    'src/editors/extensions/probeHelpers.ts',
  ],
  description:
    'Inline canvas oscilloscope widget showing a sine waveform next to a probed expression. The ;probe comment triggers a ProbeWidget that renders a live waveform via drawWaveform.',
  grepTerms: [
    'ProbeWidget',
    'drawWaveform',
    'probeField',
    'ProbeConfig',
    'createProbeExtensions',
  ],
  editor: {
    editorContent: '(sine 440) ;probe',
    extensions: ['probes'],
  },
});
