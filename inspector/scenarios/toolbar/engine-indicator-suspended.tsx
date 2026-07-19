import { defineScenario } from '../../framework/scenario';
import { EngineIndicator } from '@src/audio/engineIndicator';
import type { EngineStateSnapshot } from '@src/contracts/synthesisChannels';

const suspendedSnapshot: EngineStateSnapshot = Object.freeze({
  state: 'suspended',
  reasonKey: 'AWAITING_USER_ACTIVATION',
  reasonMessage:
    'Audio is suspended. Click the indicator or press any key to enable sound.',
  transitionCount: 1,
  transitionedAt: 0,
});

export default defineScenario({
  category: 'Toolbar & Chrome / Engine Indicator',
  name: 'Suspended (clickable recovery)',
  type: 'contract',
  sourceFiles: ['src/audio/engineIndicator.tsx'],
  description:
    'Synthesis engine indicator in the suspended state. The chip is clickable; clicking it routes through the autoplay resume path. The tooltip carries the awaiting-activation message.',
  grepTerms: [
    'EngineIndicator',
    'engine-indicator',
    'engine-indicator-suspended',
    'engine-indicator-clickable',
  ],
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <EngineIndicator state={suspendedSnapshot} onResume={() => {}} />
      </div>
    ),
    loadAppStyles: true,
    width: 320,
    height: 60,
  },
});
