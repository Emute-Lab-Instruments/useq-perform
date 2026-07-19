import { defineScenario } from '../../framework/scenario';
import { EngineIndicator } from '@src/audio/engineIndicator';
import type { EngineStateSnapshot } from '@src/contracts/synthesisChannels';

const errorSnapshot: EngineStateSnapshot = Object.freeze({
  state: 'error',
  reasonKey: 'PRODUCER_TIMEOUT',
  reasonMessage: 'The control producer stopped responding. Output has been faded to silence.',
  transitionCount: 3,
  transitionedAt: 0,
});

export default defineScenario({
  category: 'Toolbar & Chrome / Engine Indicator',
  name: 'Error (clickable recovery)',
  type: 'contract',
  sourceFiles: ['src/audio/engineIndicator.tsx'],
  description:
    'Synthesis engine indicator in the error state after a producer timeout. The chip is clickable and the tooltip carries the recovery-failed message; clicking routes through the recovery affordance.',
  grepTerms: [
    'EngineIndicator',
    'engine-indicator',
    'engine-indicator-error',
    'engine-indicator-clickable',
  ],
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <EngineIndicator state={errorSnapshot} onResume={() => {}} />
      </div>
    ),
    loadAppStyles: true,
    width: 320,
    height: 60,
  },
});
