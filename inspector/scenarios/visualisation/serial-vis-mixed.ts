import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'Mixed analog + digital',
  type: 'canary',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description:
    'Serial visualisation canvas rendering analog waveforms overlapping in the upper region with digital step waveforms in separate lanes below.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.position = 'relative';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.background = '#0a0a14';
      el.style.borderRadius = '4px';
      el.style.overflow = 'hidden';

      // Axis markings
      const timeLine = document.createElement('div');
      timeLine.style.position = 'absolute';
      timeLine.style.left = '50%';
      timeLine.style.top = '0';
      timeLine.style.width = '1px';
      timeLine.style.height = '100%';
      timeLine.style.background = 'rgba(255,255,255,0.12)';
      el.appendChild(timeLine);

      const centerAxis = document.createElement('div');
      centerAxis.style.position = 'absolute';
      centerAxis.style.left = '0';
      centerAxis.style.top = '50%';
      centerAxis.style.width = '100%';
      centerAxis.style.height = '1px';
      centerAxis.style.borderTop = '1px dashed rgba(0,255,65,0.25)';
      el.appendChild(centerAxis);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 600 300');
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';

      // Analog waveforms (upper portion, ~0-180)
      const analogChannels = [
        { color: '#ff6b6b', d: 'M0,100 Q75,40 150,80 T300,60 T450,100 T600,70', label: 'a1' },
        { color: '#4ecdc4', d: 'M0,130 Q75,70 150,110 T300,90 T450,130 T600,100', label: 'a2' },
      ];

      for (const ch of analogChannels) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', ch.d);
        path.setAttribute('stroke', ch.color);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
      }

      // Divider between analog and digital regions
      const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      divider.setAttribute('x1', '0');
      divider.setAttribute('y1', '185');
      divider.setAttribute('x2', '600');
      divider.setAttribute('y2', '185');
      divider.setAttribute('stroke', 'rgba(255,255,255,0.08)');
      divider.setAttribute('stroke-width', '1');
      divider.setAttribute('stroke-dasharray', '4,4');
      svg.appendChild(divider);

      // Digital step waveforms (lower portion, ~195-290)
      const digitalLaneHeight = 40;
      const digitalGap = 8;
      const digitalTop = 195;

      const digitalChannels = [
        {
          label: 'd1',
          color: '#ffe66d',
          transitions: [0, 1, 100, 0, 200, 1, 320, 0, 420, 1, 530, 0, 600, 0],
        },
        {
          label: 'd2',
          color: '#a29bfe',
          transitions: [0, 0, 70, 1, 170, 0, 280, 1, 380, 0, 500, 1, 600, 1],
        },
      ];

      for (let lane = 0; lane < digitalChannels.length; lane++) {
        const ch = digitalChannels[lane];
        const laneTop = digitalTop + lane * (digitalLaneHeight + digitalGap);
        const laneBottom = laneTop + digitalLaneHeight;

        const t = ch.transitions;
        let d = '';
        for (let i = 0; i < t.length; i += 2) {
          const x = t[i];
          const val = t[i + 1];
          const y = val === 1 ? laneTop : laneBottom;
          if (i === 0) {
            d += `M${x},${y}`;
          } else {
            const prevY = t[i - 1] === 1 ? laneTop : laneBottom;
            d += ` L${x},${prevY} L${x},${y}`;
          }
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', ch.color);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linejoin', 'miter');
        path.setAttribute('stroke-linecap', 'butt');
        svg.appendChild(path);

        // Lane label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '8');
        text.setAttribute('y', String(laneTop + 12));
        text.setAttribute('fill', ch.color);
        text.setAttribute('font-size', '10');
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('opacity', '0.7');
        text.textContent = ch.label;
        svg.appendChild(text);
      }

      // Analog labels
      for (const ch of analogChannels) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '8');
        text.setAttribute('y', ch.label === 'a1' ? '36' : '56');
        text.setAttribute('fill', ch.color);
        text.setAttribute('font-size', '10');
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('opacity', '0.7');
        text.textContent = ch.label;
        svg.appendChild(text);
      }

      el.appendChild(svg);
      return el;
    },
    width: 600,
    height: 300,
  },
});
