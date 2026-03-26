import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'Guide chapter with sections',
  type: 'contract',
  sourceFiles: [
    'src/ui/help/guide/GuideTab.tsx',
    'src/ui/help/guide/GuideSection.tsx',
  ],
  description:
    'A guide chapter rendered with collapsible sections containing lesson content.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'sans-serif';

      el.innerHTML = `
        <div style="margin-bottom: 1rem;">
          <h2 style="font-size: 1.1rem; margin: 0 0 0.5rem;">Chapter: Getting Started</h2>
        </div>
        <div style="border: 1px solid #333; border-radius: 4px; margin-bottom: 0.5rem;">
          <div style="padding: 0.5rem 0.75rem; background: #1a1a2e; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.9rem;">1. What is uSEQ?</span>
            <span style="color: #606080;">&#9660;</span>
          </div>
          <div style="padding: 0.75rem; font-size: 0.8rem; color: #808098; border-top: 1px solid #333;">
            uSEQ is a programmable hardware module for generating control voltages and gates in a modular synthesiser.
          </div>
        </div>
        <div style="border: 1px solid #333; border-radius: 4px; margin-bottom: 0.5rem;">
          <div style="padding: 0.5rem 0.75rem; background: #1a1a2e; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.9rem;">2. Your First Program</span>
            <span style="color: #606080;">&#9654;</span>
          </div>
        </div>
        <div style="border: 1px solid #333; border-radius: 4px;">
          <div style="padding: 0.5rem 0.75rem; background: #1a1a2e; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.9rem;">3. Outputs and Signals</span>
            <span style="color: #606080;">&#9654;</span>
          </div>
        </div>
      `;
      return el;
    },
    width: 400,
    height: 500,
  },
});
