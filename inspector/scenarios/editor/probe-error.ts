import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Probes',
  name: 'Probe on error expression',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/probes.ts',
    'src/editors/extensions/probeHelpers.ts',
  ],
  description:
    'Probe widget attached to an expression that fails evaluation. Should display an error state (no waveform data, possibly a red or empty canvas) rather than crashing.',
  grepTerms: [
    'ProbeWidget',
    'probeField',
    'ProbeConfig',
    'createProbeExtensions',
    'drawWaveform',
  ],
  editor: {
    editorContent: '(undefined-fn 42) ;probe',
    extensions: ['probes'],
  },
});
