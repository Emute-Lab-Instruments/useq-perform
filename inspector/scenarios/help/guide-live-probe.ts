import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'Live probe in guide',
  type: 'canary',
  sourceFiles: ['src/ui/help/guide/LiveProbe.tsx'],
  description:
    'A mini oscilloscope visualisation embedded inline within guide lesson content.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'sans-serif';

      el.innerHTML = `
        <div style="font-size: 0.85rem; color: #808098; margin-bottom: 0.75rem;">
          The <code style="color: #c0c0e0; background: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">(sine freq)</code> function produces a smooth waveform:
        </div>
        <div style="border: 1px solid #333; border-radius: 4px; background: #0a0a14; padding: 0.5rem; display: inline-block;">
          <div style="font-size: 0.65rem; color: #606080; margin-bottom: 0.25rem;">a1 — sine 1Hz</div>
          <div style="width: 200px; height: 48px; position: relative;">
            <svg viewBox="0 0 200 48" style="width: 100%; height: 100%;">
              <line x1="0" y1="24" x2="200" y2="24" stroke="#222" stroke-width="0.5"/>
              <path d="M0,24 Q12.5,4 25,24 Q37.5,44 50,24 Q62.5,4 75,24 Q87.5,44 100,24 Q112.5,4 125,24 Q137.5,44 150,24 Q162.5,4 175,24 Q187.5,44 200,24" fill="none" stroke="#50c878" stroke-width="1.5"/>
            </svg>
          </div>
        </div>
        <div style="font-size: 0.85rem; color: #808098; margin-top: 0.75rem;">
          Try changing the frequency to see how the waveform responds.
        </div>
      `;
      return el;
    },
    width: 380,
    height: 250,
  },
});
