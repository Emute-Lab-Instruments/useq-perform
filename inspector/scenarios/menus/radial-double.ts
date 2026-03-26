import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Modals & Overlays / Radial Menu',
  name: 'Double radial picker',
  type: 'canary',
  sourceFiles: ['src/ui/DoubleRadialPicker.tsx'],
  description:
    'Two side-by-side radial menus: cyan-themed left ring and rose-themed right ring.',
  component: {
    component: () => {
      function buildRing(
        cx: number,
        cy: number,
        fill: string,
        stroke: string,
        textColor: string,
        labels: string[],
      ) {
        const segments = labels.length;
        const innerR = 30;
        const outerR = 70;

        function polarToCart(angle: number, r: number) {
          const rad = ((angle - 90) * Math.PI) / 180;
          return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
        }

        let paths = '';
        for (let i = 0; i < segments; i++) {
          const startAngle = (i * 360) / segments;
          const endAngle = ((i + 1) * 360) / segments;
          const midAngle = (startAngle + endAngle) / 2;

          const o1 = polarToCart(startAngle, outerR);
          const o2 = polarToCart(endAngle, outerR);
          const i1 = polarToCart(endAngle, innerR);
          const i2 = polarToCart(startAngle, innerR);
          const labelPos = polarToCart(midAngle, (innerR + outerR) / 2);

          paths += `
            <path d="M${o1.x},${o1.y} A${outerR},${outerR} 0 0,1 ${o2.x},${o2.y}
                      L${i1.x},${i1.y} A${innerR},${innerR} 0 0,0 ${i2.x},${i2.y} Z"
                  fill="${fill}" stroke="${stroke}" stroke-width="1" />
            <text x="${labelPos.x}" y="${labelPos.y}" text-anchor="middle" dominant-baseline="central"
                  fill="${textColor}" font-size="10" font-family="sans-serif">
              ${labels[i]}
            </text>
          `;
        }
        return paths;
      }

      const leftLabels = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
      const rightLabels = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

      const leftRing = buildRing(90, 90, '#1a2e3e', '#22b8cf', '#67d8e8', leftLabels);
      const rightRing = buildRing(270, 90, '#3e1a2e', '#f06292', '#f8a0c0', rightLabels);

      const el = document.createElement('div');
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.innerHTML = `<svg width="360" height="180" viewBox="0 0 360 180">${leftRing}${rightRing}</svg>`;
      return el;
    },
    width: 400,
    height: 220,
  },
});
