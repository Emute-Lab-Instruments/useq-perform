import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Reference',
  name: 'Reference search and filter',
  type: 'canary',
  sourceFiles: [
    'src/ui/help/ReferenceFilters.tsx',
    'src/ui/help/ReferencePanel.tsx',
  ],
  description:
    'Search input with category filter buttons and a filtered list of reference functions.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'sans-serif';

      const tagActive =
        'display: inline-block; padding: 0.2rem 0.5rem; font-size: 0.7rem; border-radius: 3px; cursor: pointer; background: #3a3a6a; color: #c0c0e0; border: 1px solid #555;';
      const tagInactive =
        'display: inline-block; padding: 0.2rem 0.5rem; font-size: 0.7rem; border-radius: 3px; cursor: pointer; background: transparent; color: #606080; border: 1px solid #333;';
      const itemStyle =
        'padding: 0.5rem 0.6rem; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: baseline;';

      el.innerHTML = `
        <div style="margin-bottom: 0.75rem;">
          <input type="text" value="sin" style="width: 100%; box-sizing: border-box; padding: 0.4rem 0.6rem; background: #0e0e18; border: 1px solid #333; border-radius: 4px; color: #c0c0e0; font-size: 0.85rem; outline: none;" />
        </div>
        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
          <span style="${tagInactive}">All</span>
          <span style="${tagActive}">Math</span>
          <span style="${tagInactive}">Signals</span>
          <span style="${tagInactive}">Timing</span>
          <span style="${tagInactive}">Logic</span>
          <span style="${tagInactive}">Sequencing</span>
        </div>
        <div style="border: 1px solid #333; border-radius: 4px; background: #12121e; overflow: hidden;">
          <div style="${itemStyle}">
            <span style="font-family: monospace; font-size: 0.85rem; color: #c0c0e0;">sine</span>
            <span style="font-size: 0.7rem; color: #606080;">Math</span>
          </div>
          <div style="${itemStyle}">
            <span style="font-family: monospace; font-size: 0.85rem; color: #c0c0e0;">sinew</span>
            <span style="font-size: 0.7rem; color: #606080;">Math</span>
          </div>
          <div style="${itemStyle} border-bottom: none;">
            <span style="font-family: monospace; font-size: 0.85rem; color: #c0c0e0;">asin</span>
            <span style="font-size: 0.7rem; color: #606080;">Math</span>
          </div>
        </div>
      `;
      return el;
    },
    width: 380,
    height: 400,
  },
});
