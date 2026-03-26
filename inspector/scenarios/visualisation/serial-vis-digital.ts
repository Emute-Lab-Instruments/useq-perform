import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'Digital channels (d1-d3)',
  type: 'contract',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description:
    'Serial visualisation canvas rendering three digital channels (d1-d3) as step/square waveforms in separate lanes with gaps between them.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.position = 'relative';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.background = '#0a0a14';
      el.style.borderRadius = '4px';
      el.style.overflow = 'hidden';

      // Center time line
      const timeLine = document.createElement('div');
      timeLine.style.position = 'absolute';
      timeLine.style.left = '50%';
      timeLine.style.top = '0';
      timeLine.style.width = '1px';
      timeLine.style.height = '100%';
      timeLine.style.background = 'rgba(255,255,255,0.12)';
      el.appendChild(timeLine);

      // SVG with 3 digital lanes
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 600 300');
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';

      const laneHeight = 80;
      const laneGap = 16;
      const paddingTop = 22;

      const digitalChannels = [
        {
          label: 'd1',
          color: '#ff6b6b',
          // Square wave pattern: high-low-high-low
          transitions: [0, 1, 120, 0, 200, 1, 300, 0, 380, 1, 480, 0, 550, 1, 600, 1],
        },
        {
          label: 'd2',
          color: '#4ecdc4',
          transitions: [0, 0, 80, 1, 180, 0, 260, 1, 350, 0, 440, 1, 520, 0, 600, 0],
        },
        {
          label: 'd3',
          color: '#ffe66d',
          transitions: [0, 1, 60, 0, 140, 1, 240, 0, 340, 1, 400, 0, 500, 1, 600, 1],
        },
      ];

      for (let lane = 0; lane < digitalChannels.length; lane++) {
        const ch = digitalChannels[lane];
        const laneTop = paddingTop + lane * (laneHeight + laneGap);
        const laneBottom = laneTop + laneHeight;

        // Lane separator line
        if (lane > 0) {
          const sep = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          sep.setAttribute('x1', '0');
          sep.setAttribute('y1', String(laneTop - laneGap / 2));
          sep.setAttribute('x2', '600');
          sep.setAttribute('y2', String(laneTop - laneGap / 2));
          sep.setAttribute('stroke', 'rgba(255,255,255,0.06)');
          sep.setAttribute('stroke-width', '1');
          svg.appendChild(sep);
        }

        // Build step path
        const t = ch.transitions;
        let d = '';
        for (let i = 0; i < t.length; i += 2) {
          const x = t[i];
          const val = t[i + 1];
          const y = val === 1 ? laneTop : laneBottom;
          if (i === 0) {
            d += `M${x},${y}`;
          } else {
            // Step: horizontal then vertical
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
        text.setAttribute('y', String(laneTop + 14));
        text.setAttribute('fill', ch.color);
        text.setAttribute('font-size', '11');
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
