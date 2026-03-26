import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI / Form Controls',
  name: 'Collapsible sections',
  type: 'canary',
  sourceFiles: ['src/ui/settings/FormControls.tsx'],
  description:
    'Collapsible section with an arrow toggle indicator and a nested SubGroup inside.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';

      el.innerHTML = `
        <p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>
        <div style="margin-top: 0.75rem; border: 1px solid #303050; border-radius: 6px; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: #1a1a2e; cursor: pointer;">
            <span style="font-size: 0.7rem; transform: rotate(90deg); display: inline-block;">&#9654;</span>
            <span style="font-size: 0.85rem; font-weight: 600;">Advanced Options</span>
          </div>
          <div style="padding: 0.5rem 0.75rem 0.75rem;">
            <div style="padding: 0.25rem 0; font-size: 0.8rem;">Setting A: enabled</div>
            <div style="margin-top: 0.5rem; padding-left: 0.75rem; border-left: 2px solid #303050;">
              <div style="font-size: 0.75rem; color: #808098; margin-bottom: 0.25rem;">SubGroup</div>
              <div style="padding: 0.25rem 0; font-size: 0.8rem;">Nested setting: 100</div>
            </div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; border: 1px solid #303050; border-radius: 6px; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: #1a1a2e; cursor: pointer;">
            <span style="font-size: 0.7rem; display: inline-block;">&#9654;</span>
            <span style="font-size: 0.85rem; font-weight: 600;">Collapsed Section</span>
          </div>
        </div>
      `;
      return el;
    },
    width: 400,
    height: 400,
  },
});
