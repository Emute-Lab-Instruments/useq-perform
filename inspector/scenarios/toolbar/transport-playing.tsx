import { defineScenario } from '../../framework/scenario';
import { TransportToolbar } from '@src/ui/TransportToolbar';

export default defineScenario({
  category: 'Toolbar & Chrome / Transport Toolbar',
  name: 'Playing state',
  type: 'contract',
  sourceFiles: [
    'src/ui/TransportToolbar.tsx',
  ],
  description: 'Transport toolbar in playing state with hardware mode. Play button shows primary/disabled, pause and stop are active, rewind and clear enabled.',
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <TransportToolbar
          state="playing"
          mode="hardware"
          progress={0.5}
          onPlay={() => {}}
          onPause={() => {}}
          onStop={() => {}}
          onRewind={() => {}}
          onClear={() => {}}
        />
      </div>
    ),
    loadAppStyles: true,
    width: 800,
    height: 80,
  },
});
