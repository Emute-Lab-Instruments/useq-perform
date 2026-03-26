import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'Interactive playground',
  type: 'canary',
  sourceFiles: ['src/ui/help/guide/Playground.tsx'],
  description:
    'A draggable code playground block with live probe visualisation embedded in guide content.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'sans-serif';

      el.innerHTML = `
        <div style="border: 1px solid #444; border-radius: 6px; background: #12121e; overflow: hidden;">
          <div style="padding: 0.4rem 0.75rem; background: #1a1a2e; display: flex; justify-content: space-between; align-items: center; cursor: grab; border-bottom: 1px solid #333;">
            <span style="font-size: 0.75rem; color: #606080;">&#9776; Playground</span>
            <span style="font-size: 0.7rem; color: #50c878;">&#9654; Live</span>
          </div>
          <div style="padding: 0.75rem; font-family: monospace; font-size: 0.8rem; background: #0e0e18; min-height: 60px; color: #c0c0e0;">
            (a1 (sine 1))
          </div>
          <div style="padding: 0.5rem 0.75rem; border-top: 1px solid #333; display: flex; align-items: center; gap: 0.5rem;">
            <div style="width: 100%; height: 32px; background: #0a0a14; border-radius: 3px; position: relative; overflow: hidden;">
              <svg viewBox="0 0 200 32" style="width: 100%; height: 100%;">
                <path d="M0,16 Q25,0 50,16 Q75,32 100,16 Q125,0 150,16 Q175,32 200,16" fill="none" stroke="#50c878" stroke-width="1.5"/>
              </svg>
            </div>
          </div>
        </div>
      `;
      return el;
    },
    width: 380,
    height: 250,
  },
});
