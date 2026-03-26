import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI / Editor Settings',
  name: 'Editor preferences',
  type: 'contract',
  sourceFiles: ['src/ui/settings/EditorSettings.tsx'],
  description:
    'Editor settings panel showing font size, tab width, and vim mode toggle controls.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';

      el.innerHTML = `
        <p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.75rem;">
          <div>
            <label style="font-size: 0.8rem; display: block; margin-bottom: 0.25rem;">Font Size</label>
            <input type="number" value="14" min="8" max="32" style="width: 80px; background: #1a1a2e; color: #a0a0c0; border: 1px solid #303050; border-radius: 4px; padding: 0.25rem 0.5rem;" />
            <span style="font-size: 0.7rem; color: #606080;">px</span>
          </div>
          <div>
            <label style="font-size: 0.8rem; display: block; margin-bottom: 0.25rem;">Tab Width</label>
            <input type="number" value="2" min="1" max="8" style="width: 80px; background: #1a1a2e; color: #a0a0c0; border: 1px solid #303050; border-radius: 4px; padding: 0.25rem 0.5rem;" />
            <span style="font-size: 0.7rem; color: #606080;">spaces</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <div style="width: 36px; height: 20px; border-radius: 10px; background: #303050; position: relative;">
              <div style="width: 16px; height: 16px; border-radius: 50%; background: #606080; position: absolute; top: 2px; left: 2px;"></div>
            </div>
            <label style="font-size: 0.8rem;">Vim Mode</label>
          </div>
        </div>
      `;
      return el;
    },
    width: 400,
    height: 400,
  },
});
