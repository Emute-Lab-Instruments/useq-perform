import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Toolbar & Chrome / Transport Toolbar',
  name: 'Paused state',
  type: 'contract',
  sourceFiles: [
    'src/ui/TransportToolbar.tsx',
  ],
  description: 'Transport toolbar in paused state. Pause button shows primary/disabled, play, stop, and rewind are active.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">TransportToolbar paused state: pause button disabled (primary disabled class), play, stop, and rewind active, clear enabled, progress bar frozen at current position</p>';
      return el;
    },
    width: 800,
    height: 80,
  },
});
