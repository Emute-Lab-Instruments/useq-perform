import { defineScenario } from '../../framework/scenario';
import { TransportToolbar } from '@src/ui/TransportToolbar';

export default defineScenario({
  category: 'Toolbar & Chrome / Transport Toolbar',
  name: 'Paused state',
  type: 'contract',
  sourceFiles: [
    'src/ui/TransportToolbar.tsx',
  ],
  description: 'Transport toolbar in paused state with hardware mode. Pause button shows primary/disabled, play, stop, and rewind are active, clear enabled, progress bar frozen at 35%.',
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <TransportToolbar
          state="paused"
          mode="hardware"
          progress={0.35}
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
