import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import type { Tab } from '@src/ui/Tabs';

const tabs: Tab[] = [
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

          {/* Expanded section */}
          <div class="guide-section guide-section--expanded">
            <div class="guide-section-header">
              <span class="guide-section-arrow">{'\u25BC'}</span>
              <span class="guide-section-title">1. What is uSEQ?</span>
              <span class="guide-section-summary">A programmable module for modular synthesis</span>
            </div>
            <div class="guide-section-body" style={{ padding: '0.75rem', "font-size": '0.8rem', color: '#808098' }}>
              uSEQ is a programmable hardware module for generating control voltages
              and gates in a modular synthesiser. It runs a Lisp dialect called
              ModuLisp, designed for real-time signal generation.
            </div>
          </div>

          {/* Collapsed sections */}
          <div class="guide-section">
            <div class="guide-section-header">
              <span class="guide-section-arrow">{'\u25B6'}</span>
              <span class="guide-section-title">2. Your First Program</span>
              <span class="guide-section-summary">Write and evaluate expressions</span>
            </div>
          </div>
          <div class="guide-section">
            <div class="guide-section-header">
              <span class="guide-section-arrow">{'\u25B6'}</span>
              <span class="guide-section-title">3. Outputs and Signals</span>
              <span class="guide-section-summary">Analogue, digital, and serial outputs</span>
            </div>
          </div>
        </div>

        <div class="guide-domain-divider" style={{ "margin-top": '1.5rem' }}>{'\u2501\u2501 HARDWARE \u2501\u2501'}</div>
        <div class="guide-chapter">
          <div class="guide-chapter-header">
            <h3 class="guide-chapter-title">Inputs and Connectivity</h3>
            <span class="guide-chapter-summary">Using analogue and digital inputs</span>
          </div>
          <div class="guide-section">
            <div class="guide-section-header">
              <span class="guide-section-arrow">{'\u25B6'}</span>
              <span class="guide-section-title">1. Analogue Inputs</span>
              <span class="guide-section-summary">Reading CV and audio signals</span>
            </div>
          </div>
        </div>
      </div>
    ),
  },
];

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'Guide chapter with sections',
  type: 'contract',
  sourceFiles: [
    'src/ui/help/guide/GuideTab.tsx',
    'src/ui/help/guide/GuideSection.tsx',
    'src/ui/help/HelpPanel.tsx',
  ],
  description:
    'HelpPanel with a single Guide tab containing collapsible chapter sections. ' +
    'Verify the domain dividers, chapter headers, expanded/collapsed section states, ' +
    'and section summaries all render correctly.',
  component: {
    render: () => <HelpPanel tabs={tabs} />,
    loadAppStyles: true,
    width: 450,
    height: 600,
  },
});
