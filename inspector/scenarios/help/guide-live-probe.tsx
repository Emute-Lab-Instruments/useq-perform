import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import type { Tab } from '@src/ui/Tabs';

/**
 * The real LiveProbe component is coupled to runtime (WASM eval, transport).
 * This tab provides static HTML that mimics its visual structure: inline
 * descriptive text with a mini oscilloscope visualisation.
 */
const tabs: Tab[] = [
  {
    id: 'panel-help-tab-guide-v2',
    name: 'Guide',
    content: () => (
      <div class="guide-tab" style={{ padding: '1rem', color: '#a0a0c0' }}>
        <div style={{ "font-size": '0.85rem', color: '#808098', "margin-bottom": '0.75rem' }}>
          The <code style={{
            color: '#c0c0e0',
            background: '#1a1a2e',
            padding: '0.1rem 0.3rem',
            "border-radius": '3px',
          }}>(sine freq)</code> function produces a smooth waveform:
        </div>

        {/* Mini oscilloscope */}
        <div style={{
          border: '1px solid #333',
          "border-radius": '4px',
          background: '#0a0a14',
          padding: '0.5rem',
          display: 'inline-block',
        }}>
          <div style={{ "font-size": '0.65rem', color: '#606080', "margin-bottom": '0.25rem' }}>
            a1 — sine 1Hz
          </div>
          <div style={{ width: '200px', height: '48px', position: 'relative' }}>
            <svg viewBox="0 0 200 48" style={{ width: '100%', height: '100%' }}>
              <line x1="0" y1="24" x2="200" y2="24" stroke="#222" stroke-width="0.5" />
              <path
                d="M0,24 Q12.5,4 25,24 Q37.5,44 50,24 Q62.5,4 75,24 Q87.5,44 100,24 Q112.5,4 125,24 Q137.5,44 150,24 Q162.5,4 175,24 Q187.5,44 200,24"
                fill="none"
                stroke="#50c878"
                stroke-width="1.5"
              />
            </svg>
          </div>
        </div>

        <div style={{ "font-size": '0.85rem', color: '#808098', "margin-top": '0.75rem' }}>
          Try changing the frequency to see how the waveform responds.
          Higher values produce faster oscillations, while values below 1
          create slow-moving LFOs.
        </div>

        <div style={{ "font-size": '0.75rem', color: '#606080', "margin-top": '0.5rem' }}>
          Note: In the real guide, this probe is interactive with live WASM evaluation.
        </div>
      </div>
    ),
  },
];

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'Live probe in guide',
  type: 'canary',
  sourceFiles: [
    'src/ui/help/guide/LiveProbe.tsx',
    'src/ui/help/HelpPanel.tsx',
  ],
  description:
    'HelpPanel with a Guide tab showing an inline mini oscilloscope. ' +
    'The real LiveProbe is coupled to runtime, so this renders static HTML ' +
    'mimicking its visual structure: descriptive text with an SVG sine wave.',
  component: {
    render: () => <HelpPanel tabs={tabs} />,
    loadAppStyles: true,
    width: 450,
    height: 400,
  },
});
