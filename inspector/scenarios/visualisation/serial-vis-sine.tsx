import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Visualisation / Serial Vis',
  name: 'Sine wave',
  type: 'canary',
  sourceFiles: [
    'src/ui/visualisation/serialVis.ts',
  ],
  description: 'Serial visualisation canvas rendering a single-channel sine wave signal with y-axis markings (-1 to 1), dashed zero-line, and waveform in #00ff41.',
  component: {
    render: () => {
      // Generate sine wave path
      const points: string[] = [];
      for (let x = 0; x <= 600; x += 2) {
        const t = (x / 600) * Math.PI * 4; // 2 full cycles
        const y = 150 - Math.sin(t) * 120;  // center at 150, amplitude 120
        points.push(`${x},${y.toFixed(1)}`);
      }
      const sineD = `M${points.join(' L')}`;

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

          {/* Sine waveform */}
          <path d={sineD} stroke="#00ff41" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />

          {/* Channel label */}
          <text x="8" y="20" fill="#00ff41" font-size="11" font-family="monospace" opacity="0.7">a1</text>
        </svg>
      );
    },
    width: 600,
    height: 300,
  },
});
