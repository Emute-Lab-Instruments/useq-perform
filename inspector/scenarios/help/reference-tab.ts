import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Help Panel',
  name: 'Reference tab',
  type: 'contract',
  sourceFiles: [
    'src/ui/help/HelpPanel.tsx',
    'src/ui/help/ModuLispReferenceTab.tsx',
  ],
  description: 'Help panel showing the ModuLisp reference tab with function documentation.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.innerHTML = '<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p><p style="margin-top: 0.5rem;">HelpPanel reference tab</p>';
      return el;
    },
    width: 400,
    height: 600,
  },
});
