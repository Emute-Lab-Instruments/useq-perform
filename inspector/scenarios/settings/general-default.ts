import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI / General Settings',
  name: 'Default state',
  type: 'contract',
  sourceFiles: [
    'src/ui/settings/GeneralSettings.tsx',
    'src/ui/settings/FormControls.tsx',
  ],
  description: 'General settings panel in its default state with all controls at their default values.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">GeneralSettings with default values</p>';
      return el;
    },
    width: 400,
    height: 600,
  },
});
