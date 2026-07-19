import { defineScenario } from '../../framework/scenario';
import { EngineIndicator } from '@src/audio/engineIndicator';
import type { EngineStateSnapshot } from '@src/contracts/synthesisChannels';

// The 'off' state with capability present renders the chip as a
// non-clickable affordance. The 'NO_AUDIO_CAPABILITY' reason renders
// nothing; that case is covered by the compiler diagnostic channel.
const offSnapshot: EngineStateSnapshot = Object.freeze({
  state: 'off',
  reasonKey: null,
  reasonMessage: null,
  transitionCount: 0,
  transitionedAt: 0,
});

export default defineScenario({
  category: 'Toolbar & Chrome / Engine Indicator',
  name: 'Off (capability present, not yet activated)',
  type: 'contract',
  sourceFiles: ['src/audio/engineIndicator.tsx'],
  description:
    'Synthesis engine indicator in the off state with audio capability present but the engine not yet brought up. The chip renders as a non-clickable affordance. (When audio capability is absent the indicator renders nothing; that path is covered by the capability diagnostic.)',
  grepTerms: [
    'EngineIndicator',
    'engine-indicator',
    'engine-indicator-off',
    'engine-indicator-disabled',
  ],
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <EngineIndicator state={offSnapshot} onResume={() => {}} />
      </div>
    ),
    loadAppStyles: true,
    width: 320,
    height: 60,
  },
});
