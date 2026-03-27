import { defineScenario } from '../../framework/scenario';
import { TransportToolbar } from '@src/ui/TransportToolbar';

export default defineScenario({
  category: 'Toolbar & Chrome / Transport Toolbar',
  name: 'Stopped state',
  type: 'contract',
  sourceFiles: [
    'src/ui/TransportToolbar.tsx',
  ],
  description: 'Transport toolbar in stopped state with wasm mode. Stop button shows primary/disabled, pause disabled, play and rewind active, clear enabled, progress bar empty.',
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <TransportToolbar
          state="stopped"
          mode="wasm"
          progress={0}
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
