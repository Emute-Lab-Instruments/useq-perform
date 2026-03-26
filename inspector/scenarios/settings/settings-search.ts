import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Settings UI',
  name: 'Settings search filtering',
  type: 'canary',
  sourceFiles: ['src/ui/settings/settingsSearch.ts'],
  description:
    'Search input that filters visible settings, auto-expanding matching sections and hiding non-matching ones.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';

      el.innerHTML = `
        <p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>
        <div style="margin-top: 0.75rem;">
          <input type="text" value="font" placeholder="Search settings..." style="width: 100%; background: #1a1a2e; color: #a0a0c0; border: 1px solid #303050; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.85rem; box-sizing: border-box;" />
          <div style="margin-top: 0.75rem;">
            <div style="border: 1px solid #303050; border-radius: 6px; overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: #1a1a2e;">
                <span style="font-size: 0.7rem; transform: rotate(90deg); display: inline-block;">&#9654;</span>
                <span style="font-size: 0.85rem; font-weight: 600;">Editor</span>
                <span style="font-size: 0.65rem; color: #606080; margin-left: auto;">auto-expanded</span>
              </div>
              <div style="padding: 0.5rem 0.75rem;">
                <div style="padding: 0.25rem 0; font-size: 0.8rem;"><mark style="background: #3a3a20; color: #e0e080; padding: 0 2px; border-radius: 2px;">Font</mark> Size: 14px</div>
                <div style="padding: 0.25rem 0; font-size: 0.8rem;"><mark style="background: #3a3a20; color: #e0e080; padding: 0 2px; border-radius: 2px;">Font</mark> Family: monospace</div>
              </div>
            </div>
            <div style="margin-top: 0.5rem; opacity: 0.3; font-size: 0.75rem; padding: 0.25rem 0.75rem; color: #606080;">
              Visualisation — no matches
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
