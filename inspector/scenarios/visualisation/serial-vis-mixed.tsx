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
    render: () => {
      // Analog waveform generators
      const analogChannels = [
        { color: '#00ff41', label: 'a1' },
        { color: '#1adbdb', label: 'a2' },
      ];

      function generateAnalogPath(idx: number): string {
        const points: string[] = [];
        for (let x = 0; x <= 600; x += 2) {
          const t = (x / 600) * Math.PI * 2;
          let val: number;
          if (idx === 0) {
            val = Math.sin(t * 3);
          } else {
            val = Math.sin(t * 2 + 1.2);
          }
          // Map to upper region (y: 20-170)
          const y = 95 - val * 70;
          points.push(`${x},${y.toFixed(1)}`);
        }
        return `M${points.join(' L')}`;
      }

      // Digital channels
      const digitalLaneHeight = 40;
      const digitalGap = 8;
      const digitalTop = 195;

      const digitalChannels = [
        {
          label: 'd1',
          color: '#ff5500',
          transitions: [0, 1, 100, 0, 200, 1, 320, 0, 420, 1, 530, 0, 600, 0],
        },
        {
          label: 'd2',
          color: '#ffee33',
          transitions: [0, 0, 70, 1, 170, 0, 280, 1, 380, 0, 500, 1, 600, 1],
        },
      ];

      function buildStepPath(transitions: number[], laneTop: number, laneBottom: number): string {
        let d = '';
        for (let i = 0; i < transitions.length; i += 2) {
          const x = transitions[i];
          const val = transitions[i + 1];
          const y = val === 1 ? laneTop : laneBottom;
          if (i === 0) {
            d += `M${x},${y}`;
          } else {
            const prevY = transitions[i - 1] === 1 ? laneTop : laneBottom;
            d += ` L${x},${prevY} L${x},${y}`;
          }
        }
        return d;
      }

      return (
        <svg width="600" height="300" style="background: #0a0a14; border-radius: 4px;">
          {/* Y-axis markings for analog region */}
          {[
            { value: '1.00', y: 25 },
            { value: '0.00', y: 95 },
            { value: '-1.00', y: 165 },
          ].map((tick) => (
            <>
              <line x1="0" y1={tick.y} x2="8" y2={tick.y} stroke="rgba(0,255,65,0.3)" stroke-width="1" />
              <text x="12" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="9" font-family="monospace">{tick.value}</text>
            </>
          ))}

          {/* Dashed zero-line for analog region */}
          <line x1="0" y1="95" x2="600" y2="95" stroke="rgba(0,255,65,0.25)" stroke-width="1" stroke-dasharray="6,4" />

          {/* Center time line */}
          <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

          {/* Analog waveforms */}
          {analogChannels.map((ch, idx) => (
            <path d={generateAnalogPath(idx)} stroke={ch.color} stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          ))}

          {/* Analog channel labels */}
          {analogChannels.map((ch, idx) => (
            <text x="8" y={36 + idx * 20} fill={ch.color} font-size="10" font-family="monospace" opacity="0.7">{ch.label}</text>
          ))}

          {/* Divider between analog and digital regions */}
          <line x1="0" y1="185" x2="600" y2="185" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4,4" />

          {/* Digital waveforms */}
          {digitalChannels.map((ch, lane) => {
            const laneTop = digitalTop + lane * (digitalLaneHeight + digitalGap);
            const laneBottom = laneTop + digitalLaneHeight;
            return (
              <>
                <path
                  d={buildStepPath(ch.transitions, laneTop, laneBottom)}
                  stroke={ch.color} stroke-width="1.5" fill="none"
                  stroke-linejoin="miter" stroke-linecap="butt"
                />
                <text x="8" y={laneTop + 12} fill={ch.color} font-size="10" font-family="monospace" opacity="0.7">
                  {ch.label}
                </text>
              </>
            );
          })}
        </svg>
      );
    },
    width: 600,
    height: 300,
  },
});
