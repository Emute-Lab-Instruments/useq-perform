import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import type { Tab } from '@src/ui/Tabs';

const tabs: Tab[] = [
  {
    id: 'panel-help-tab-snippets',
    name: 'Code Snippets',
    content: () => (
      <div class="code-snippets-container" style={{ padding: '1rem' }}>
        <div class="code-snippets-header">
          <div class="code-snippets-search-bar">
            <input
              type="text"
              class="code-snippets-search"
              placeholder="Search snippets..."
              disabled
            />
            <button class="code-snippet-add-btn" disabled>+ Add Snippet</button>
          </div>
        </div>

        {/* Category: LFOs & Modulation */}
        <h3 style={{ "font-size": '0.9rem', margin: '0.75rem 0', color: '#808098' }}>
          LFOs &amp; Modulation
        </h3>
        <div class="code-snippets-list" style={{
          display: 'grid',
          "grid-template-columns": '1fr 1fr',
          gap: '0.5rem',
          "margin-bottom": '1rem',
        }}>
          <div class="code-snippet-card" style={{
            border: '1px solid #333',
            "border-radius": '4px',
            padding: '0.6rem',
            background: '#12121e',
            cursor: 'pointer',
          }}>
            <div style={{ "font-size": '0.85rem', color: '#c0c0e0', margin: '0 0 0.3rem' }}>Sine LFO</div>
            <div style={{ "font-family": 'monospace', "font-size": '0.7rem', color: '#606080', "white-space": 'nowrap', overflow: 'hidden', "text-overflow": 'ellipsis' }}>
              (a1 (sine 0.5))
            </div>
          </div>
          <div class="code-snippet-card" style={{
            border: '1px solid #333',
            "border-radius": '4px',
            padding: '0.6rem',
            background: '#12121e',
            cursor: 'pointer',
          }}>
            <div style={{ "font-size": '0.85rem', color: '#c0c0e0', margin: '0 0 0.3rem' }}>Triangle LFO</div>
            <div style={{ "font-family": 'monospace', "font-size": '0.7rem', color: '#606080', "white-space": 'nowrap', overflow: 'hidden', "text-overflow": 'ellipsis' }}>
              (a1 (tri 1))
            </div>
          </div>
          <div class="code-snippet-card" style={{
            border: '1px solid #333',
            "border-radius": '4px',
            padding: '0.6rem',
            background: '#12121e',
            cursor: 'pointer',
          }}>
            <div style={{ "font-size": '0.85rem', color: '#c0c0e0', margin: '0 0 0.3rem' }}>Ramp</div>
            <div style={{ "font-family": 'monospace', "font-size": '0.7rem', color: '#606080', "white-space": 'nowrap', overflow: 'hidden', "text-overflow": 'ellipsis' }}>
              (a1 (phasor 2))
            </div>
          </div>
          <div class="code-snippet-card" style={{
            border: '1px solid #333',
            "border-radius": '4px',
            padding: '0.6rem',
            background: '#12121e',
            cursor: 'pointer',
          }}>
            <div style={{ "font-size": '0.85rem', color: '#c0c0e0', margin: '0 0 0.3rem' }}>Random S&amp;H</div>
            <div style={{ "font-family": 'monospace', "font-size": '0.7rem', color: '#606080', "white-space": 'nowrap', overflow: 'hidden', "text-overflow": 'ellipsis' }}>
              (a1 (randh 4))
            </div>
          </div>
        </div>

        {/* Category: Sequencing */}
        <h3 style={{ "font-size": '0.9rem', margin: '0 0 0.75rem', color: '#808098' }}>
          Sequencing
        </h3>
        <div class="code-snippets-list" style={{
          display: 'grid',
          "grid-template-columns": '1fr 1fr',
          gap: '0.5rem',
        }}>
          <div class="code-snippet-card" style={{
            border: '1px solid #333',
            "border-radius": '4px',
            padding: '0.6rem',
            background: '#12121e',
            cursor: 'pointer',
          }}>
            <div style={{ "font-size": '0.85rem', color: '#c0c0e0', margin: '0 0 0.3rem' }}>Step Sequence</div>
            <div style={{ "font-family": 'monospace', "font-size": '0.7rem', color: '#606080', "white-space": 'nowrap', overflow: 'hidden', "text-overflow": 'ellipsis' }}>
              (a1 (step 0.2 0.5 0.8))
            </div>
          </div>
          <div class="code-snippet-card" style={{
            border: '1px solid #333',
            "border-radius": '4px',
            padding: '0.6rem',
            background: '#12121e',
            cursor: 'pointer',
          }}>
            <div style={{ "font-size": '0.85rem', color: '#c0c0e0', margin: '0 0 0.3rem' }}>Euclidean Gate</div>
            <div style={{ "font-family": 'monospace', "font-size": '0.7rem', color: '#606080', "white-space": 'nowrap', overflow: 'hidden', "text-overflow": 'ellipsis' }}>
              (d1 (euclid 5 8))
            </div>
          </div>
        </div>
      </div>
    ),
  },
];

export default defineScenario({
  category: 'Help & Reference / Code Snippets',
  name: 'Snippet library',
  type: 'contract',
  sourceFiles: [
    'src/ui/help/CodeSnippetsTab.tsx',
    'src/ui/help/HelpPanel.tsx',
  ],
  description:
    'HelpPanel with a Code Snippets tab showing a grid of snippet cards ' +
    'organised by category. Verify card layout, category headers, code ' +
    'preview text, and search bar chrome.',
  component: {
    render: () => <HelpPanel tabs={tabs} />,
    loadAppStyles: true,
    width: 450,
    height: 600,
  },
});
