import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI / Theme Settings',
  name: 'Theme selector',
  type: 'contract',
  sourceFiles: ['src/ui/settings/ThemeSettings.tsx'],
  description:
    'Theme settings panel showing a grid of theme preview cards with the active theme highlighted.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';

      const themes = ['Midnight', 'Ember', 'Firesky', 'Glacier', 'Moss'];
      const cards = themes
        .map(
          (t, i) =>
            `<div style="border: 2px solid ${i === 0 ? '#7070ff' : '#303050'}; border-radius: 6px; padding: 0.75rem; text-align: center; background: ${i === 0 ? '#1a1a30' : '#12121e'}; cursor: pointer;">${t}${i === 0 ? ' <span style="color: #7070ff; font-size: 0.7rem;">✓ active</span>' : ''}</div>`,
        )
        .join('');

      el.innerHTML = `
        <p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>
        <h3 style="margin: 0.75rem 0 0.5rem; font-size: 0.9rem;">Theme</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">${cards}</div>
      `;
      return el;
    },
    width: 400,
    height: 400,
  },
});
