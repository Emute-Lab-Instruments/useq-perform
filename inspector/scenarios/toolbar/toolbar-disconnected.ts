import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Toolbar & Chrome / Main Toolbar',
  name: 'Disconnected state',
  type: 'contract',
  sourceFiles: [
    'src/ui/MainToolbar.tsx',
  ],
  description: 'Main toolbar when fully disconnected. No hardware or WASM connection active.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">MainToolbar disconnected state: connect button gray (transport-none class), all transport-dependent controls disabled</p>';
      return el;
    },
    width: 800,
    height: 80,
  },
});
