import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Probes',
  name: 'Multiple probes',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/probes.ts',
    'src/editors/extensions/probeHelpers.ts',
  ],
  description:
    'Three probed expressions on separate lines. Tests visual layout of multiple inline canvas widgets stacked vertically without overlap or clipping.',
  grepTerms: [
    'ProbeWidget',
    'probeField',
    'ProbeConfig',
    'createProbeExtensions',
    'drawWaveform',
  ],
  editor: {
    editorContent: [
      '(sine 440) ;probe',
      '(saw 220) ;probe',
      '(tri 110) ;probe',
    ].join('\n'),
    extensions: ['probes'],
  },
});
