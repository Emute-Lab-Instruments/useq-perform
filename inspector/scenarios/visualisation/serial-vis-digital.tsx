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
    render: () => {
      const laneHeight = 80;
      const laneGap = 16;
      const paddingTop = 22;

      const digitalChannels = [
        {
          label: 'd1',
          color: '#ff5500',
          transitions: [0, 1, 120, 0, 200, 1, 300, 0, 380, 1, 480, 0, 550, 1, 600, 1],
        },
        {
          label: 'd2',
          color: '#ffee33',
          transitions: [0, 0, 80, 1, 180, 0, 260, 1, 350, 0, 440, 1, 520, 0, 600, 0],
        },
        {
          label: 'd3',
          color: '#0088ff',
          transitions: [0, 1, 60, 0, 140, 1, 240, 0, 340, 1, 400, 0, 500, 1, 600, 1],
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
          {/* Center time line */}
          <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

          {digitalChannels.map((ch, lane) => {
            const laneTop = paddingTop + lane * (laneHeight + laneGap);
            const laneBottom = laneTop + laneHeight;
            return (
              <>
                {/* Lane separator */}
                {lane > 0 && (
                  <line
                    x1="0" y1={laneTop - laneGap / 2}
                    x2="600" y2={laneTop - laneGap / 2}
                    stroke="rgba(255,255,255,0.06)" stroke-width="1"
                  />
                )}

                {/* Step waveform */}
                <path
                  d={buildStepPath(ch.transitions, laneTop, laneBottom)}
                  stroke={ch.color} stroke-width="1.5" fill="none"
                  stroke-linejoin="miter" stroke-linecap="butt"
                />

                {/* Lane label */}
                <text x="8" y={laneTop + 14} fill={ch.color} font-size="11" font-family="monospace" opacity="0.7">
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
