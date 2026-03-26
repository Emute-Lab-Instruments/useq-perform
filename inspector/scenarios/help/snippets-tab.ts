import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Help & Reference / Code Snippets',
  name: 'Snippet library',
  type: 'contract',
  sourceFiles: ['src/ui/help/CodeSnippetsTab.tsx'],
  description:
    'Grid of snippet cards organised by category, showing the snippet library tab.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'sans-serif';

      const cardStyle =
        'border: 1px solid #333; border-radius: 4px; padding: 0.6rem; background: #12121e; cursor: pointer;';
      const titleStyle = 'font-size: 0.85rem; color: #c0c0e0; margin: 0 0 0.3rem;';
      const previewStyle =
        'font-family: monospace; font-size: 0.7rem; color: #606080; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

      el.innerHTML = `
        <h3 style="font-size: 0.9rem; margin: 0 0 0.75rem; color: #808098;">LFOs &amp; Modulation</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
          <div style="${cardStyle}">
            <div style="${titleStyle}">Sine LFO</div>
            <div style="${previewStyle}">(a1 (sine 0.5))</div>
          </div>
          <div style="${cardStyle}">
            <div style="${titleStyle}">Triangle LFO</div>
            <div style="${previewStyle}">(a1 (tri 1))</div>
          </div>
          <div style="${cardStyle}">
            <div style="${titleStyle}">Ramp</div>
            <div style="${previewStyle}">(a1 (phasor 2))</div>
          </div>
          <div style="${cardStyle}">
            <div style="${titleStyle}">Random S&amp;H</div>
            <div style="${previewStyle}">(a1 (randh 4))</div>
          </div>
        </div>
        <h3 style="font-size: 0.9rem; margin: 0 0 0.75rem; color: #808098;">Sequencing</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div style="${cardStyle}">
            <div style="${titleStyle}">Step Sequence</div>
            <div style="${previewStyle}">(a1 (step 0.2 0.5 0.8))</div>
          </div>
          <div style="${cardStyle}">
            <div style="${titleStyle}">Euclidean Gate</div>
            <div style="${previewStyle}">(d1 (euclid 5 8))</div>
          </div>
        </div>
      `;
      return el;
    },
    width: 400,
    height: 500,
  },
});
