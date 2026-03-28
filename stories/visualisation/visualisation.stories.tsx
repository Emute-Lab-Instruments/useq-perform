import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { VisLegend } from '@src/ui/VisLegend';

const meta: Meta = {
  title: 'Visualisation',
};
export default meta;
type Story = StoryObj;

/** Sine wave visualization. */
export const SerialVisSine: Story = {
  render: () => {
    // Generate sine wave path
    const points: string[] = [];
    for (let x = 0; x <= 600; x += 2) {
      const t = (x / 600) * Math.PI * 4; // 2 full cycles
      const y = 150 - Math.sin(t) * 120; // center at 150, amplitude 120
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
            <text x="14" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="10" font-family="monospace">
              {tick.value}
            </text>
          </>
        ))}

        {/* Dashed zero-line */}
        <line x1="0" y1="150" x2="600" y2="150" stroke="rgba(0,255,65,0.25)" stroke-width="1" stroke-dasharray="6,4" />

        {/* Center time line */}
        <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

        {/* Sine waveform */}
        <path d={sineD} stroke="#00ff41" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />

        {/* Channel label */}
        <text x="8" y="20" fill="#00ff41" font-size="11" font-family="monospace" opacity="0.7">
          a1
        </text>
      </svg>
    );
  },
};

/** Multiple analog channels (a1-a4). */
export const SerialVisMultichannel: Story = {
  render: () => {
    const channels = [
      { color: '#00ff41', label: 'a1', freq: 3, phase: 0, amp: 100 },
      { color: '#1adbdb', label: 'a2', freq: 2, phase: 1.2, amp: 80 },
      { color: '#ffaa00', label: 'a3', freq: 4, phase: 2.5, amp: 60 },
      { color: '#ff0080', label: 'a4', freq: 1.5, phase: 0.8, amp: 90 },
    ];

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
            <text x="14" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="10" font-family="monospace">
              {tick.value}
            </text>
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
          <text x={540 + idx * 16} y="290" fill={ch.color} font-size="10" font-family="monospace">
            {ch.label}
          </text>
        ))}
      </svg>
    );
  },
};

/** Digital channels (d1-d3). */
export const SerialVisDigital: Story = {
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
                  x1="0"
                  y1={laneTop - laneGap / 2}
                  x2="600"
                  y2={laneTop - laneGap / 2}
                  stroke="rgba(255,255,255,0.06)"
                  stroke-width="1"
                />
              )}

              {/* Step waveform */}
              <path
                d={buildStepPath(ch.transitions, laneTop, laneBottom)}
                stroke={ch.color}
                stroke-width="1.5"
                fill="none"
                stroke-linejoin="miter"
                stroke-linecap="butt"
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
};

/** Mixed analog + digital channels. */
export const SerialVisMixed: Story = {
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
            <text x="12" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="9" font-family="monospace">
              {tick.value}
            </text>
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
          <text x="8" y={36 + idx * 20} fill={ch.color} font-size="10" font-family="monospace" opacity="0.7">
            {ch.label}
          </text>
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
                stroke={ch.color}
                stroke-width="1.5"
                fill="none"
                stroke-linejoin="miter"
                stroke-linecap="butt"
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
};

/** Empty state visualization. */
export const SerialVisEmpty: Story = {
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
          <text x="14" y={tick.y + 3} fill="rgba(0,255,65,0.5)" font-size="10" font-family="monospace">
            {tick.value}
          </text>
        </>
      ))}

      {/* Dashed zero-line (0.50 center) */}
      <line x1="0" y1="150" x2="600" y2="150" stroke="rgba(0,255,65,0.25)" stroke-width="1" stroke-dasharray="6,4" />

      {/* Center time line */}
      <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

      {/* Empty state message */}
      <text x="300" y="150" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.5)" font-size="12" font-family="monospace">
        No expressions selected for visualisation
      </text>
    </svg>
  ),
};

/** Channel legend with active/inactive states. */
export const VisLegendReal: Story = {
  render: () => (
    <VisLegend
      channels={[
        { channel: 'a1', color: '#00ff41', active: true, label: 'a1' },
        { channel: 'a2', color: '#1adbdb', active: true, label: 'a2' },
        { channel: 'a3', color: '#ffaa00', active: false, label: 'a3' },
        { channel: 'a4', color: '#ff0080', active: false, label: 'a4' },
        { channel: 'd1', color: '#ff5500', active: true, label: 'd1' },
        { channel: 'd2', color: '#ffee33', active: false, label: 'd2' },
        { channel: 'd3', color: '#0088ff', active: false, label: 'd3' },
      ]}
    />
  ),
};
