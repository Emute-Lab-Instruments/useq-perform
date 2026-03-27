import { defineScenario } from '../../framework/scenario';
import { Modal } from '@src/ui/Modal';

/**
 * The real SnippetModal imports snippetStore, CodeMirrorEditor, editorStore,
 * and overlayManager — all coupled to runtime. Instead, we render a Modal
 * (already refactored to props) with static content matching the snippet
 * detail visual structure.
 */
export default defineScenario({
  category: 'Help & Reference / Code Snippets',
  name: 'Snippet detail modal',
  type: 'canary',
  sourceFiles: [
    'src/ui/help/SnippetModal.tsx',
    'src/ui/Modal.tsx',
  ],
  description:
    'Modal showing a single snippet with syntax-highlighted code and action buttons. ' +
    'The real SnippetModal is coupled to runtime stores, so this renders a Modal ' +
    'shell with static snippet content. Verify modal chrome, code display, and button layout.',
  component: {
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
    loadAppStyles: true,
    width: 500,
    height: 450,
  },
});
