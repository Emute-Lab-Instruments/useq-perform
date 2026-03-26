import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Code Snippets',
  name: 'Snippet detail modal',
  type: 'canary',
  sourceFiles: ['src/ui/help/SnippetModal.tsx'],
  description:
    'Modal overlay showing a single snippet with syntax-highlighted code and a copy button.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '0';
      el.style.fontFamily = 'sans-serif';

      el.innerHTML = `
        <div style="background: rgba(0,0,0,0.6); padding: 2rem; display: flex; align-items: center; justify-content: center; min-height: 300px;">
          <div style="background: #16162a; border: 1px solid #444; border-radius: 8px; width: 340px; overflow: hidden;">
            <div style="padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333;">
              <span style="font-size: 0.95rem; color: #c0c0e0;">Sine LFO</span>
              <span style="cursor: pointer; color: #606080; font-size: 1.1rem;">&times;</span>
            </div>
            <div style="padding: 1rem; font-family: monospace; font-size: 0.85rem; background: #0e0e18; color: #c0c0e0; line-height: 1.6;">
              <div><span style="color: #606080;">;; Smooth sine LFO on output a1</span></div>
              <div>(<span style="color: #7b8cde;">a1</span> (<span style="color: #50c878;">sine</span> <span style="color: #d4a56a;">0.5</span>))</div>
            </div>
            <div style="padding: 0.6rem 1rem; border-top: 1px solid #333; display: flex; justify-content: flex-end; gap: 0.5rem;">
              <button style="background: #2a2a4a; color: #a0a0c0; border: 1px solid #444; border-radius: 4px; padding: 0.3rem 0.75rem; font-size: 0.8rem; cursor: pointer;">Copy</button>
              <button style="background: #3a3a6a; color: #c0c0e0; border: 1px solid #555; border-radius: 4px; padding: 0.3rem 0.75rem; font-size: 0.8rem; cursor: pointer;">Insert</button>
            </div>
          </div>
        </div>
      `;
      return el;
    },
    width: 450,
    height: 380,
  },
});
