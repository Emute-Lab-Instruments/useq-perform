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
    render: () => (
      <svg width="600" height="300" style="background: #0a0a14; border-radius: 4px;">
        {/* Y-axis tick marks and labels */}
        {[
          { value: '1.00', y: 30 },
          { value: '0.75', y: 90 },
          { value: '0.50', y: 150 },
          { value: '0.25', y: 210 },
          { value: '0.00', y: 270 },
        ].map((tick) => (
          <>
            <line x1="0" y1={tick.y} x2="10" y2={tick.y} stroke="rgba(0,255,65,0.3)" stroke-width="1" />
            <text x="14" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="10" font-family="monospace">{tick.value}</text>
          </>
        ))}

        {/* Dashed zero-line (0.50 center) */}
        <line x1="0" y1="150" x2="600" y2="150" stroke="rgba(0,255,65,0.25)" stroke-width="1" stroke-dasharray="6,4" />

        {/* Center time line */}
        <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

        {/* Empty state message */}
        <text
          x="300" y="150"
          text-anchor="middle" dominant-baseline="middle"
          fill="rgba(255,255,255,0.5)" font-size="12" font-family="monospace"
        >
          No expressions selected for visualisation
        </text>
      </svg>
    ),
    width: 600,
    height: 300,
  },
});
