import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'Empty state (no active expressions)',
  type: 'canary',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description:
    'Serial visualisation canvas in its empty state: axis markings visible but no waveform data rendered. Matches the drawEmptyState() code path.',
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

      // Center axis (0.5 line)
      const centerAxis = document.createElement('div');
      centerAxis.style.position = 'absolute';
      centerAxis.style.left = '0';
      centerAxis.style.top = '50%';
      centerAxis.style.width = '100%';
      centerAxis.style.height = '1px';
      centerAxis.style.borderTop = '1px dashed rgba(0,255,65,0.25)';
      el.appendChild(centerAxis);

      // Y-axis tick marks and labels
      const labels = [
        { value: '1.00', top: '10%' },
        { value: '0.75', top: '30%' },
        { value: '0.50', top: '50%' },
        { value: '0.25', top: '70%' },
        { value: '0.00', top: '90%' },
      ];

      for (const l of labels) {
        // Tick mark
        const tick = document.createElement('div');
        tick.style.position = 'absolute';
        tick.style.left = '0';
        tick.style.top = l.top;
        tick.style.width = '10px';
        tick.style.height = '1px';
        tick.style.background = 'rgba(0,255,65,0.3)';
        tick.style.transform = 'translateY(-50%)';
        el.appendChild(tick);

        // Label
        const label = document.createElement('span');
        label.textContent = l.value;
        label.style.position = 'absolute';
        label.style.left = '12px';
        label.style.top = l.top;
        label.style.transform = 'translateY(-50%)';
        label.style.fontSize = '10px';
        label.style.fontFamily = 'Arial, sans-serif';
        label.style.color = 'rgba(0,255,65,0.5)';
        el.appendChild(label);
      }

      // Empty state message (matching drawEmptyState())
      const message = document.createElement('div');
      message.textContent = 'No expressions selected for visualisation';
      message.style.position = 'absolute';
      message.style.top = '50%';
      message.style.left = '50%';
      message.style.transform = 'translate(-50%, -50%)';
      message.style.fontSize = '12px';
      message.style.fontFamily = 'monospace';
      message.style.color = 'rgba(255,255,255,0.5)';
      message.style.whiteSpace = 'nowrap';
      el.appendChild(message);

      return el;
    },
    width: 600,
    height: 300,
  },
});
