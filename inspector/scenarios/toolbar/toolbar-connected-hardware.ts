import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Toolbar & Chrome / Main Toolbar',
  name: 'Connected to hardware',
  type: 'contract',
  sourceFiles: [
    'src/ui/MainToolbar.tsx',
  ],
  description: 'Main toolbar when connected to hardware via serial. Connect button should be blue with active cable icon.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">MainToolbar hardware-connected state: connect button blue (transport-hardware class), cable icon active, all toolbar buttons enabled</p>';
      return el;
    },
    width: 800,
    height: 80,
  },
});
