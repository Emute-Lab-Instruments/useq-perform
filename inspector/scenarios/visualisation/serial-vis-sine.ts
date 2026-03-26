import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'Sine wave',
  type: 'canary',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description: 'Serial visualisation canvas rendering a single-channel sine wave signal.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — canvas rendering pending</p><p style="margin-top: 0.5rem;">SerialVis with sine wave data</p>';
      return el;
    },
    width: 600,
    height: 300,
  },
});
