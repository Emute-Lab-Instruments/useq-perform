import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import { Modal } from '@src/ui/Modal';
import type { Tab } from '@src/ui/Tabs';

/**
 * Standalone tabs that avoid runtime service imports (stores, transport,
 * adapters). Each story renders representative static content so the full
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

const guideChapterTabs: Tab[] = [
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

const playgroundTabs: Tab[] = [
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

const liveProbeTabs: Tab[] = [
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

const snippetsTabsTabs: Tab[] = [
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

const referenceSearchTabs: Tab[] = [
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

const meta: Meta = {
  title: 'Help',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const FullPanel: Story = {
  render: () => <HelpPanel tabs={inspectorTabs} />,
};

export const GuideChapter: Story = {
  render: () => <HelpPanel tabs={guideChapterTabs} />,
};

export const InteractivePlayground: Story = {
  render: () => <HelpPanel tabs={playgroundTabs} />,
};

export const LiveProbe: Story = {
  render: () => <HelpPanel tabs={liveProbeTabs} />,
};

export const SnippetsLibrary: Story = {
  render: () => <HelpPanel tabs={snippetsTabsTabs} />,
};

export const ReferenceSearch: Story = {
  render: () => <HelpPanel tabs={referenceSearchTabs} />,
};

export const SnippetModal: Story = {
  render: () => (
    <div style={{ background: 'rgba(0,0,0,0.4)', padding: '2rem', "min-height": '300px', display: 'flex', "align-items": 'center', "justify-content": 'center' }}>
      <Modal title="Sine LFO" onClose={() => {}}>
        <div style={{ padding: '0' }}>
          {/* Form fields mimicking SnippetModal */}
          <div class="code-snippet-form-group" style={{ "margin-bottom": '0.75rem' }}>
            <label style={{ display: 'block', "font-size": '0.8rem', color: '#808098', "margin-bottom": '0.25rem' }}>Title:</label>
            <input
              type="text"
              class="code-snippet-input"
              value="Sine LFO"
              readonly
              style={{ width: '100%', "box-sizing": 'border-box', padding: '0.4rem 0.6rem', background: '#0e0e18', border: '1px solid #333', "border-radius": '4px', color: '#c0c0e0', "font-size": '0.85rem' }}
            />
          </div>

          <div class="code-snippet-form-group" style={{ "margin-bottom": '0.75rem' }}>
            <label style={{ display: 'block', "font-size": '0.8rem', color: '#808098', "margin-bottom": '0.25rem' }}>Tags:</label>
            <input
              type="text"
              class="code-snippet-input"
              value="lfo, modulation, sine"
              readonly
              style={{ width: '100%', "box-sizing": 'border-box', padding: '0.4rem 0.6rem', background: '#0e0e18', border: '1px solid #333', "border-radius": '4px', color: '#c0c0e0', "font-size": '0.85rem' }}
            />
          </div>

          <div class="code-snippet-form-group">
            <label style={{ display: 'block', "font-size": '0.8rem', color: '#808098', "margin-bottom": '0.25rem' }}>Code:</label>
            <div style={{
              "font-family": 'monospace',
              "font-size": '0.85rem',
              background: '#0e0e18',
              border: '1px solid #333',
              "border-radius": '4px',
              padding: '0.75rem',
              color: '#c0c0e0',
              "line-height": '1.6',
              "min-height": '80px',
            }}>
              <div><span style={{ color: '#606080' }}>;; Smooth sine LFO on output a1</span></div>
              <div>(<span style={{ color: '#7b8cde' }}>a1</span> (<span style={{ color: '#50c878' }}>sine</span> <span style={{ color: '#d4a56a' }}>0.5</span>))</div>
            </div>
          </div>

          <div style={{
            "margin-top": '0.75rem',
            display: 'flex',
            "justify-content": 'flex-end',
            gap: '0.5rem',
          }}>
            <button style={{
              background: '#2a2a4a',
              color: '#a0a0c0',
              border: '1px solid #444',
              "border-radius": '4px',
              padding: '0.3rem 0.75rem',
              "font-size": '0.8rem',
              cursor: 'pointer',
            }}>Cancel</button>
            <button style={{
              background: '#3a3a6a',
              color: '#c0c0e0',
              border: '1px solid #555',
              "border-radius": '4px',
              padding: '0.3rem 0.75rem',
              "font-size": '0.8rem',
              cursor: 'pointer',
            }}>Save</button>
          </div>
        </div>
      </Modal>
    </div>
  ),
};
