import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI / Form Controls',
  name: 'Number input (drag-adjust)',
  type: 'canary',
  sourceFiles: ['src/ui/settings/FormControls.tsx'],
  description:
    'Number input that supports drag-to-adjust: dragging up increases the value, dragging down decreases it, and holding shift enables fine control.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';

      el.innerHTML = `
        <p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>
        <div style="margin-top: 0.75rem;">
          <label style="font-size: 0.8rem; display: block; margin-bottom: 0.25rem;">Value</label>
          <div style="display: inline-flex; align-items: center; background: #1a1a2e; border: 1px solid #303050; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: ns-resize;">
            <span style="font-size: 0.9rem;">42</span>
          </div>
          <p style="font-size: 0.7rem; color: #606080; margin-top: 0.5rem;">Drag up/down to adjust. Hold Shift for fine control.</p>
        </div>
      `;
      return el;
    },
    width: 300,
    height: 250,
  },
});
