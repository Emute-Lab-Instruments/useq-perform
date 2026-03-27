import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Probes',
  name: 'Text mode probe',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/probes.ts',
    'src/editors/extensions/probeHelpers.ts',
  ],
  description:
    'Probe displaying text output (0 or 1) instead of a waveform canvas. Boolean-valued expressions should render in text mode rather than drawing a waveform.',
  grepTerms: [
    'ProbeWidget',
    'probeField',
    'ProbeConfig',
    'createProbeExtensions',
    'textMode',
  ],
  editor: {
    editorContent: '(> (phase 1) 0.5) ;probe',
    extensions: ['probes'],
  },
});
