import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI / Visualisation Settings',
  name: 'All controls',
  type: 'contract',
  sourceFiles: ['src/ui/settings/VisualisationSettings.tsx'],
  description:
    'Visualisation settings panel showing probe refresh rate, line width, and palette selection controls.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';

      el.innerHTML = `
        <p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.75rem;">
          <div>
            <label style="font-size: 0.8rem; display: block; margin-bottom: 0.25rem;">Probe Refresh Rate</label>
            <input type="range" min="16" max="200" value="60" style="width: 100%;" />
            <span style="font-size: 0.7rem; color: #606080;">60 ms</span>
          </div>
          <div>
            <label style="font-size: 0.8rem; display: block; margin-bottom: 0.25rem;">Line Width</label>
            <input type="range" min="1" max="8" value="2" style="width: 100%;" />
            <span style="font-size: 0.7rem; color: #606080;">2 px</span>
          </div>
          <div>
            <label style="font-size: 0.8rem; display: block; margin-bottom: 0.25rem;">Palette</label>
            <div style="display: flex; gap: 0.5rem;">
              <div style="width: 24px; height: 24px; border-radius: 4px; background: #ff6060; border: 2px solid #7070ff;"></div>
              <div style="width: 24px; height: 24px; border-radius: 4px; background: #60ff90; border: 2px solid transparent;"></div>
              <div style="width: 24px; height: 24px; border-radius: 4px; background: #6080ff; border: 2px solid transparent;"></div>
            </div>
          </div>
        </div>
      `;
      return el;
    },
    width: 400,
    height: 500,
  },
});
