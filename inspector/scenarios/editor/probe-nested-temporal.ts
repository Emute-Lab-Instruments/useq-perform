import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Probes',
  name: 'Probe with temporal wrapper',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/probes.ts',
    'src/editors/extensions/probeHelpers.ts',
  ],
  description:
    'Probe on an expression wrapped in a slow temporal modifier. Tests that depth-aware rendering handles nested structures correctly and the canvas renders at the right position.',
  grepTerms: [
    'ProbeWidget',
    'probeField',
    'ProbeConfig',
    'createProbeExtensions',
    'drawWaveform',
  ],
  editor: {
    editorContent: '(slow 4 (sine 110)) ;probe',
    extensions: ['probes'],
  },
});
