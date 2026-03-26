import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Legend',
  name: 'Channel legend with active expressions',
  type: 'contract',
  sourceFiles: [
    'src/ui/VisLegend.tsx',
  ],
  description:
    'Horizontal legend showing colored swatches with channel labels. Active channels at full opacity, inactive channels at reduced (0.4) opacity.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '12px';
      el.style.padding = '8px 12px';
      el.style.background = '#0a0a14';
      el.style.borderRadius = '4px';
      el.style.fontFamily = 'monospace';
      el.style.fontSize = '11px';

      const channels = [
        { label: 'a1', color: '#ff6b6b', active: true },
        { label: 'a2', color: '#4ecdc4', active: true },
        { label: 'a3', color: '#ffe66d', active: false },
        { label: 'a4', color: '#a29bfe', active: false },
        { label: 'd1', color: '#ff9f43', active: true },
        { label: 'd2', color: '#54a0ff', active: false },
        { label: 'd3', color: '#5f27cd', active: true },
      ];

      for (const ch of channels) {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '4px';
        item.style.opacity = ch.active ? '1' : '0.4';

        // Color swatch
        const swatch = document.createElement('span');
        swatch.style.display = 'inline-block';
        swatch.style.width = '10px';
        swatch.style.height = '10px';
        swatch.style.borderRadius = '2px';
        swatch.style.background = ch.color;
        item.appendChild(swatch);

        // Channel label
        const label = document.createElement('span');
        label.textContent = ch.label;
        label.style.color = '#c0c0d0';
        item.appendChild(label);

        el.appendChild(item);
      }

      return el;
    },
    width: 500,
    height: 50,
  },
});
