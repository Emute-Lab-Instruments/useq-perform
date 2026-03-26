import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Toolbar & Chrome / Main Toolbar',
  name: 'WASM interpreter only',
  type: 'contract',
  sourceFiles: [
    'src/ui/MainToolbar.tsx',
  ],
  description: 'Main toolbar when running in browser-local mode with WASM interpreter only, no hardware connected.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">MainToolbar WASM-only state: connect button cyan (transport-wasm class), no hardware connection, cable icon indicates browser-local mode</p>';
      return el;
    },
    width: 800,
    height: 80,
  },
});
