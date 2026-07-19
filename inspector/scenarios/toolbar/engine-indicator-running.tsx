import { defineScenario } from '../../framework/scenario';
import { EngineIndicator } from '@src/audio/engineIndicator';
import type { EngineStateSnapshot } from '@src/contracts/synthesisChannels';

const runningSnapshot: EngineStateSnapshot = Object.freeze({
  state: 'running',
  reasonKey: null,
  reasonMessage: null,
  transitionCount: 2,
  transitionedAt: 0,
});

export default defineScenario({
  category: 'Toolbar & Chrome / Engine Indicator',
  name: 'Running (non-clickable)',
  type: 'contract',
  sourceFiles: ['src/audio/engineIndicator.tsx'],
  description:
    'Synthesis engine indicator in the running state. The chip is non-clickable; aria-pressed is true. The label reads "Running".',
  grepTerms: [
    'EngineIndicator',
    'engine-indicator',
    'engine-indicator-running',
    'engine-indicator-disabled',
  ],
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <EngineIndicator state={runningSnapshot} onResume={() => {}} />
      </div>
    ),
    loadAppStyles: true,
    width: 320,
    height: 60,
  },
});
