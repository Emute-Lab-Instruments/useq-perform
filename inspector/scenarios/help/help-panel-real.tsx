import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import type { Tab } from '@src/ui/Tabs';

/**
 * Standalone tabs that avoid runtime service imports (stores, transport,
 * adapters). Each tab renders representative static content so the full
 * HelpPanel chrome can be reviewed without the app runtime.
 */
const inspectorTabs: Tab[] = [
  {
    id: 'panel-help-tab-guide-v2',
    name: 'Guide',
    content: () => (
      <div class="guide-tab" style={{ padding: '1rem', color: '#a0a0c0' }}>
        <div class="guide-domain-divider">{'\u2501\u2501 LANGUAGE \u2501\u2501'}</div>
        <div class="guide-chapter">
          <div class="guide-chapter-header">
            <h3 class="guide-chapter-title">Getting Started</h3>
            <span class="guide-chapter-summary">Learn the basics of ModuLisp</span>
          </div>
          <div class="guide-section guide-section--expanded">
            <div class="guide-section-header">
              <span class="guide-section-arrow">{'\u25B6'}</span>
              <span class="guide-section-title">What is uSEQ?</span>
              <span class="guide-section-summary">A programmable module for modular synthesis</span>
            </div>
          </div>
          <div class="guide-section">
            <div class="guide-section-header">
              <span class="guide-section-arrow">{'\u25B6'}</span>
              <span class="guide-section-title">Your First Program</span>
              <span class="guide-section-summary">Write and evaluate expressions</span>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'panel-help-tab-reference',
    name: 'Reference',
    content: () => (
      <div class="modulisp-reference-container" style={{ padding: '1rem' }}>
        <div class="doc-function-list">
          <div class="doc-function-item" data-function="sin">
            <div class="doc-function-header">
              <code class="doc-function-name">sin</code>
              <span class="doc-tag">oscillator</span>
            </div>
            <div class="doc-function-description">Sine wave oscillator</div>
          </div>
          <div class="doc-function-item" data-function="sqr">
            <div class="doc-function-header">
              <code class="doc-function-name">sqr</code>
              <span class="doc-tag">oscillator</span>
            </div>
            <div class="doc-function-description">Square wave oscillator</div>
          </div>
          <div class="doc-function-item" data-function="euclid">
            <div class="doc-function-header">
              <code class="doc-function-name">euclid</code>
              <span class="doc-tag">rhythm</span>
            </div>
            <div class="doc-function-description">Euclidean rhythm generator</div>
          </div>
        </div>
      </div>
    ),
  },
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
        <div class="code-snippets-list">
          <div class="code-snippets-empty">
            No snippets yet. Click "Add Snippet" to create one!
          </div>
        </div>
      </div>
    ),
  },
];

export default defineScenario({
  category: 'Help & Reference / Help Panel',
  name: 'Full help panel (real)',
  type: 'contract',
  sourceFiles: [
    'src/ui/help/HelpPanel.tsx',
    'src/ui/Tabs.tsx',
  ],
  description:
    'Real HelpPanel component rendered with static inspector tabs. ' +
    'Verify tab switching works, panel chrome renders correctly, and ' +
    'all three tabs (Guide, Reference, Code Snippets) are navigable.',
  component: {
    render: () => <HelpPanel tabs={inspectorTabs} />,
    loadAppStyles: true,
    width: 500,
    height: 700,
  },
});
