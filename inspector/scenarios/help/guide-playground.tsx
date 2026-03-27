import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import type { Tab } from '@src/ui/Tabs';

/**
 * The real Playground component is coupled to the runtime (WASM eval,
 * transport). This tab provides static HTML that mimics the Playground's
 * visual structure: a draggable header, a code area, and a waveform preview.
 */
const tabs: Tab[] = [
  {
    id: 'panel-help-tab-guide-v2',
    name: 'Guide',
    content: () => (
      <div class="guide-tab" style={{ padding: '1rem', color: '#a0a0c0' }}>
        <div style={{ "font-size": '0.85rem', color: '#808098', "margin-bottom": '0.75rem' }}>
          Try modifying the code below to see how different waveforms behave.
          The playground evaluates expressions in a sandboxed environment.
        </div>

        <div style={{
          border: '1px solid #444',
          "border-radius": '6px',
          background: '#12121e',
          overflow: 'hidden',
        }}>
          {/* Draggable header bar */}
          <div style={{
            padding: '0.4rem 0.75rem',
            background: '#1a1a2e',
            display: 'flex',
            "justify-content": 'space-between',
            "align-items": 'center',
            cursor: 'grab',
            "border-bottom": '1px solid #333',
          }}>
            <span style={{ "font-size": '0.75rem', color: '#606080' }}>{'\u2630'} Playground</span>
            <span style={{ "font-size": '0.7rem', color: '#50c878' }}>{'\u25B6'} Live</span>
          </div>

          {/* Code area */}
          <div style={{
            padding: '0.75rem',
            "font-family": 'monospace',
            "font-size": '0.8rem',
            background: '#0e0e18',
            "min-height": '60px',
            color: '#c0c0e0',
          }}>
            (a1 (sine 1))
          </div>

          {/* Waveform preview */}
          <div style={{
            padding: '0.5rem 0.75rem',
            "border-top": '1px solid #333',
            display: 'flex',
            "align-items": 'center',
            gap: '0.5rem',
          }}>
            <div style={{
              width: '100%',
              height: '32px',
              background: '#0a0a14',
              "border-radius": '3px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <svg viewBox="0 0 200 32" style={{ width: '100%', height: '100%' }}>
                <path
                  d="M0,16 Q25,0 50,16 Q75,32 100,16 Q125,0 150,16 Q175,32 200,16"
                  fill="none"
                  stroke="#50c878"
                  stroke-width="1.5"
                />
              </svg>
            </div>
          </div>
        </div>

        <div style={{ "font-size": '0.75rem', color: '#606080', "margin-top": '0.5rem' }}>
          Note: In the real guide, this playground is interactive with live WASM evaluation.
        </div>
      </div>
    ),
  },
];

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'Interactive playground',
  type: 'canary',
  sourceFiles: [
    'src/ui/help/guide/Playground.tsx',
    'src/ui/help/HelpPanel.tsx',
  ],
  description:
    'HelpPanel with a Guide tab showing the playground component structure. ' +
    'The real Playground is coupled to runtime, so this renders static HTML ' +
    'mimicking its visual layout: draggable header, code area, and waveform preview.',
  component: {
    render: () => <HelpPanel tabs={tabs} />,
    loadAppStyles: true,
    width: 450,
    height: 400,
  },
});
