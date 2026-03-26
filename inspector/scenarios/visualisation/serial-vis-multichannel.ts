import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'All analog channels (a1-a4)',
  type: 'contract',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description:
    'Serial visualisation canvas rendering four analog channels (a1-a4) as overlapping colored waveforms.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.position = 'relative';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.background = '#0a0a14';
      el.style.borderRadius = '4px';
      el.style.overflow = 'hidden';

      // Y-axis markings
      const axisMarkings = document.createElement('div');
      axisMarkings.style.position = 'absolute';
      axisMarkings.style.left = '0';
      axisMarkings.style.top = '0';
      axisMarkings.style.width = '100%';
      axisMarkings.style.height = '100%';
      axisMarkings.style.pointerEvents = 'none';

      const labels = [
        { value: '1.00', top: '10%' },
        { value: '0.75', top: '30%' },
        { value: '0.50', top: '50%' },
        { value: '0.25', top: '70%' },
        { value: '0.00', top: '90%' },
      ];
      for (const l of labels) {
        const tick = document.createElement('span');
        tick.textContent = l.value;
        tick.style.position = 'absolute';
        tick.style.left = '4px';
        tick.style.top = l.top;
        tick.style.transform = 'translateY(-50%)';
        tick.style.fontSize = '9px';
        tick.style.fontFamily = 'monospace';
        tick.style.color = 'rgba(255,255,255,0.35)';
        axisMarkings.appendChild(tick);
      }

      // Center time line
      const timeLine = document.createElement('div');
      timeLine.style.position = 'absolute';
      timeLine.style.left = '50%';
      timeLine.style.top = '0';
      timeLine.style.width = '1px';
      timeLine.style.height = '100%';
      timeLine.style.background = 'rgba(255,255,255,0.12)';
      axisMarkings.appendChild(timeLine);

      // Center axis
      const centerAxis = document.createElement('div');
      centerAxis.style.position = 'absolute';
      centerAxis.style.left = '0';
      centerAxis.style.top = '50%';
      centerAxis.style.width = '100%';
      centerAxis.style.height = '1px';
      centerAxis.style.borderTop = '1px dashed rgba(0,255,65,0.25)';
      axisMarkings.appendChild(centerAxis);

      el.appendChild(axisMarkings);

      // SVG waveforms for 4 analog channels
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 600 300');
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';

      const channels = [
        { color: '#ff6b6b', d: 'M0,150 Q75,60 150,120 T300,90 T450,150 T600,110' },
        { color: '#4ecdc4', d: 'M0,180 Q75,100 150,160 T300,130 T450,180 T600,145' },
        { color: '#ffe66d', d: 'M0,130 Q75,200 150,170 T300,200 T450,140 T600,175' },
        { color: '#a29bfe', d: 'M0,200 Q75,150 150,190 T300,160 T450,210 T600,170' },
      ];

      for (const ch of channels) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', ch.d);
        path.setAttribute('stroke', ch.color);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
      }

      el.appendChild(svg);

      // Legend
      const legend = document.createElement('div');
      legend.style.position = 'absolute';
      legend.style.bottom = '6px';
      legend.style.right = '8px';
      legend.style.display = 'flex';
      legend.style.gap = '10px';
      legend.style.fontSize = '10px';
      legend.style.fontFamily = 'monospace';

      for (let i = 0; i < channels.length; i++) {
        const item = document.createElement('span');
        item.style.color = channels[i].color;
        item.textContent = `a${i + 1}`;
        legend.appendChild(item);
      }
      el.appendChild(legend);

      return el;
    },
    width: 600,
    height: 300,
  },
});
