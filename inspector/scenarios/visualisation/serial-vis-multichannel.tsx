import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'All analog channels (a1-a4)',
  type: 'contract',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description:
    'Serial visualisation canvas rendering four analog channels (a1-a4) as overlapping colored waveforms using the actual app palette colors.',
  component: {
    render: () => {
      const channels = [
        { color: '#00ff41', label: 'a1', freq: 3, phase: 0, amp: 100 },
        { color: '#1adbdb', label: 'a2', freq: 2, phase: 1.2, amp: 80 },
        { color: '#ffaa00', label: 'a3', freq: 4, phase: 2.5, amp: 60 },
        { color: '#ff0080', label: 'a4', freq: 1.5, phase: 0.8, amp: 90 },
      ];

      // Generate waveform paths
      // a1: sine, a2: triangle-ish, a3: square-ish (rounded), a4: sawtooth-ish
      function generatePath(ch: typeof channels[0], idx: number): string {
        const points: string[] = [];
        for (let x = 0; x <= 600; x += 2) {
          const t = (x / 600) * Math.PI * 2 * ch.freq + ch.phase;
          let val: number;
          switch (idx) {
            case 0: // sine
              val = Math.sin(t);
              break;
            case 1: // triangle
              val = (2 / Math.PI) * Math.asin(Math.sin(t));
              break;
            case 2: // rounded square
              val = Math.tanh(Math.sin(t) * 4);
              break;
            case 3: // sawtooth
              val = 2 * ((t / (2 * Math.PI)) % 1) - 1;
              break;
            default:
              val = Math.sin(t);
          }
          const y = 150 - val * ch.amp;
          points.push(`${x},${y.toFixed(1)}`);
        }
        return `M${points.join(' L')}`;
      }

      return (
        <svg width="600" height="300" style="background: #0a0a14; border-radius: 4px;">
          {/* Y-axis tick marks and labels */}
          {[
            { value: '1.00', y: 30 },
            { value: '0.50', y: 90 },
            { value: '0.00', y: 150 },
            { value: '-0.50', y: 210 },
            { value: '-1.00', y: 270 },
          ].map((tick) => (
            <>
              <line x1="0" y1={tick.y} x2="10" y2={tick.y} stroke="rgba(0,255,65,0.3)" stroke-width="1" />
              <text x="14" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="10" font-family="monospace">{tick.value}</text>
            </>
          ))}

          {/* Dashed zero-line */}
          <line x1="0" y1="150" x2="600" y2="150" stroke="rgba(0,255,65,0.25)" stroke-width="1" stroke-dasharray="6,4" />

          {/* Center time line */}
          <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

          {/* Waveforms */}
          {channels.map((ch, idx) => (
            <path d={generatePath(ch, idx)} stroke={ch.color} stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          ))}

          {/* Legend */}
          {channels.map((ch, idx) => (
            <text x={540 + idx * 16} y="290" fill={ch.color} font-size="10" font-family="monospace">{ch.label}</text>
          ))}
        </svg>
      );
    },
    width: 600,
    height: 300,
  },
});
