import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Toolbar & Chrome / Transport Toolbar',
  name: 'Playing state',
  type: 'contract',
  sourceFiles: [
    'src/ui/TransportToolbar.tsx',
  ],
  description: 'Transport toolbar in playing state. Play button shows primary/disabled, pause and stop are active.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">TransportToolbar playing state: play button disabled (primary disabled class), pause and stop active, rewind and clear enabled, progress bar animating</p>';
      return el;
    },
    width: 800,
    height: 80,
  },
});
