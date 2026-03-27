import { defineScenario } from '../../framework/scenario';

/**
 * Visual matrix showing how blur radius and tint opacity interact.
 * Uses CSS filter: blur() as an approximation of the canvas blur in the
 * real extension.  Each cell shows a sample waveform image blurred at
 * different intensities with varying tint darkness.
 */
export default defineScenario({
  category: 'Editor Decorations / Vis Readability',
  name: 'Blur settings matrix (3x3)',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/visReadability.ts',
  ],
  description:
    'A 3x3 grid showing low/medium/high blur radius (columns) crossed with ' +
    'low/medium/high tint opacity (rows).  Each cell uses CSS filter: blur() ' +
    'over a simulated waveform SVG.  Verify that blur increases left-to-right ' +
    'and darkening increases top-to-bottom.  The bottom-right cell should be ' +
    'the most blurred and darkest — best for readability.',
  grepTerms: [
    'readabilityBlurRadius',
    'readabilityTintOpacity',
    'readabilityMaxDarken',
    'readabilityPasses',
    'readabilityAlpha',
    'VisReadabilityPlugin',
  ],
  component: {
    render: () => {
      const blurLevels = [
        { label: 'Blur: 2px', value: 2 },
        { label: 'Blur: 10px', value: 10 },
        { label: 'Blur: 25px', value: 25 },
      ];
      const tintLevels = [
        { label: 'Tint: 0.0', value: 0 },
        { label: 'Tint: 0.5', value: 0.5 },
        { label: 'Tint: 1.0', value: 1.0 },
      ];

      const cellWidth = 180;
      const cellHeight = 100;

      // Generate a sine wave SVG path for the sample waveform
      const wavePoints: string[] = [];
      for (let x = 0; x <= cellWidth; x += 2) {
        const t = (x / cellWidth) * Math.PI * 6;
        const y = cellHeight / 2 - Math.sin(t) * (cellHeight * 0.35);
        wavePoints.push(`${x},${y.toFixed(1)}`);
      }
      const waveD = `M${wavePoints.join(' L')}`;

      // Second wave for visual richness
      const wave2Points: string[] = [];
      for (let x = 0; x <= cellWidth; x += 2) {
        const t = (x / cellWidth) * Math.PI * 4 + 1;
        const y = cellHeight / 2 - Math.sin(t) * (cellHeight * 0.2) + 10;
        wave2Points.push(`${x},${y.toFixed(1)}`);
      }
      const wave2D = `M${wave2Points.join(' L')}`;

      return (
        <div style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '8px',
          padding: '16px',
          background: '#0a0a14',
          'font-family': 'monospace',
          color: '#ccc',
        }}>
          {/* Column headers */}
          <div style={{ display: 'flex', gap: '6px', 'margin-left': '70px' }}>
            {blurLevels.map((b) => (
              <div style={{
                width: `${cellWidth}px`,
                'text-align': 'center',
                'font-size': '11px',
                opacity: '0.6',
              }}>
                {b.label}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {tintLevels.map((tint) => (
            <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
              {/* Row label */}
              <div style={{
                width: '64px',
                'text-align': 'right',
                'font-size': '11px',
                opacity: '0.6',
                'flex-shrink': '0',
              }}>
                {tint.label}
              </div>

              {/* Cells */}
              {blurLevels.map((blur) => {
                const brightness = 1 - tint.value * 0.85;

                return (
                  <div style={{
                    width: `${cellWidth}px`,
                    height: `${cellHeight}px`,
                    position: 'relative',
                    overflow: 'hidden',
                    'border-radius': '4px',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                    {/* Blurred waveform layer */}
                    <div style={{
                      position: 'absolute',
                      inset: '0',
                      filter: `blur(${blur.value}px) brightness(${brightness})`,
                    }}>
                      <svg width={cellWidth} height={cellHeight} style={{ background: '#001500' }}>
                        <path d={waveD} stroke="#00ff41" stroke-width="2" fill="none" />
                        <path d={wave2D} stroke="#ff6600" stroke-width="1.5" fill="none" />
                      </svg>
                    </div>

                    {/* Code text overlay to show readability */}
                    <div style={{
                      position: 'absolute',
                      inset: '0',
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      'font-size': '11px',
                      color: '#e0e0e0',
                      'text-shadow': '0 0 2px rgba(0,0,0,0.5)',
                      'white-space': 'pre',
                    }}>
                      {'(sine a1 440)'}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Description */}
          <div style={{ 'font-size': '10px', opacity: '0.4', 'margin-top': '4px', 'margin-left': '70px' }}>
            Higher blur + tint makes code more readable against the vis background
          </div>
        </div>
      );
    },
    width: 660,
    height: 420,
  },
});
