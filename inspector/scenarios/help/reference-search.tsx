import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import type { Tab } from '@src/ui/Tabs';

const tabs: Tab[] = [
  {
    id: 'panel-help-tab-reference',
    name: 'Reference',
    content: () => (
      <div class="modulisp-reference-container" style={{ padding: '1rem' }}>
        {/* Search input */}
        <div style={{ "margin-bottom": '0.75rem' }}>
          <input
            type="text"
            value="sin"
            readonly
            style={{
              width: '100%',
              "box-sizing": 'border-box',
              padding: '0.4rem 0.6rem',
              background: '#0e0e18',
              border: '1px solid #333',
              "border-radius": '4px',
              color: '#c0c0e0',
              "font-size": '0.85rem',
              outline: 'none',
            }}
          />
        </div>

        {/* Category filter tags */}
        <div style={{ display: 'flex', gap: '0.4rem', "flex-wrap": 'wrap', "margin-bottom": '0.75rem' }}>
          <span class="doc-tag" style={{
            padding: '0.2rem 0.5rem',
            "font-size": '0.7rem',
            "border-radius": '3px',
            cursor: 'pointer',
            background: 'transparent',
            color: '#606080',
            border: '1px solid #333',
          }}>All</span>
          <span class="doc-tag" style={{
            padding: '0.2rem 0.5rem',
            "font-size": '0.7rem',
            "border-radius": '3px',
            cursor: 'pointer',
            background: '#3a3a6a',
            color: '#c0c0e0',
            border: '1px solid #555',
          }}>Math</span>
          <span class="doc-tag" style={{
            padding: '0.2rem 0.5rem',
            "font-size": '0.7rem',
            "border-radius": '3px',
            cursor: 'pointer',
            background: 'transparent',
            color: '#606080',
            border: '1px solid #333',
          }}>Signals</span>
          <span class="doc-tag" style={{
            padding: '0.2rem 0.5rem',
            "font-size": '0.7rem',
            "border-radius": '3px',
            cursor: 'pointer',
            background: 'transparent',
            color: '#606080',
            border: '1px solid #333',
          }}>Timing</span>
          <span class="doc-tag" style={{
            padding: '0.2rem 0.5rem',
            "font-size": '0.7rem',
            "border-radius": '3px',
            cursor: 'pointer',
            background: 'transparent',
            color: '#606080',
            border: '1px solid #333',
          }}>Logic</span>
          <span class="doc-tag" style={{
            padding: '0.2rem 0.5rem',
            "font-size": '0.7rem',
            "border-radius": '3px',
            cursor: 'pointer',
            background: 'transparent',
            color: '#606080',
            border: '1px solid #333',
          }}>Sequencing</span>
        </div>

        {/* Filtered function list */}
        <div class="doc-function-list">
          <div class="doc-function-item" data-function="sine">
            <div class="doc-function-header">
              <code class="doc-function-name">sine</code>
              <span class="doc-tag">Math</span>
            </div>
            <div class="doc-function-description">Sine wave oscillator</div>
          </div>
          <div class="doc-function-item" data-function="sinew">
            <div class="doc-function-header">
              <code class="doc-function-name">sinew</code>
              <span class="doc-tag">Math</span>
            </div>
            <div class="doc-function-description">Windowed sine function</div>
          </div>
          <div class="doc-function-item" data-function="asin">
            <div class="doc-function-header">
              <code class="doc-function-name">asin</code>
              <span class="doc-tag">Math</span>
            </div>
            <div class="doc-function-description">Inverse sine (arcsine)</div>
          </div>
        </div>
      </div>
    ),
  },
];

export default defineScenario({
  category: 'Help & Reference / Reference',
  name: 'Reference search and filter',
  type: 'canary',
  sourceFiles: [
    'src/ui/help/ReferenceFilters.tsx',
    'src/ui/help/ReferencePanel.tsx',
    'src/ui/help/HelpPanel.tsx',
  ],
  description:
    'HelpPanel with a Reference tab showing a search input pre-filled with "sin", ' +
    'category filter buttons (Math active), and a filtered list of matching functions. ' +
    'Verify search field, active/inactive tag styles, and function list layout.',
  component: {
    render: () => <HelpPanel tabs={tabs} />,
    loadAppStyles: true,
    width: 450,
    height: 500,
  },
});
