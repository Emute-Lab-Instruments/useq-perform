import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Modals & Overlays / Radial Menu',
  name: 'Single ring',
  type: 'contract',
  sourceFiles: ['src/ui/RadialMenu.tsx'],
  description: 'Circular SVG menu with 8 segments arranged in a ring.',
  component: {
    component: () => {
      const segments = 8;
      const cx = 120;
      const cy = 120;
      const innerR = 40;
      const outerR = 100;
      const labels = ['d1', 'd2', 'd3', 'd4', 'a1', 'a2', 'a3', 'a4'];

      function polarToCart(angle: number, r: number) {
        const rad = ((angle - 90) * Math.PI) / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
      }

      let paths = '';
      for (let i = 0; i < segments; i++) {
        const startAngle = (i * 360) / segments;
        const endAngle = ((i + 1) * 360) / segments;
        const midAngle = (startAngle + endAngle) / 2;
        const highlighted = i === 2;

        const o1 = polarToCart(startAngle, outerR);
        const o2 = polarToCart(endAngle, outerR);
        const i1 = polarToCart(endAngle, innerR);
        const i2 = polarToCart(startAngle, innerR);
        const labelPos = polarToCart(midAngle, (innerR + outerR) / 2);

        paths += `
          <path d="M${o1.x},${o1.y} A${outerR},${outerR} 0 0,1 ${o2.x},${o2.y}
                    L${i1.x},${i1.y} A${innerR},${innerR} 0 0,0 ${i2.x},${i2.y} Z"
                fill="${highlighted ? '#333366' : '#2a2a3e'}"
                stroke="#555" stroke-width="1" />
          <text x="${labelPos.x}" y="${labelPos.y}" text-anchor="middle" dominant-baseline="central"
                fill="${highlighted ? '#e0e0f0' : '#808098'}" font-size="11" font-family="sans-serif">
            ${labels[i]}
          </text>
        `;
      }

      const el = document.createElement('div');
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.innerHTML = `<svg width="240" height="240" viewBox="0 0 240 240">${paths}</svg>`;
      return el;
    },
    width: 280,
    height: 280,
  },
});
