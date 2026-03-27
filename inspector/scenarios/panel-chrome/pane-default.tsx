import { defineScenario } from '../../framework/scenario';
import { PaneChrome } from '@src/ui/panel-chrome/PaneChrome';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Pane — default (normal)',
  type: 'contract',
  sourceFiles: [
    'src/ui/panel-chrome/PaneChrome.tsx',
    'src/ui/panel-chrome/types.ts',
    'src/ui/panel-chrome/usePointerDrag.ts',
  ],
  description:
    'PaneChrome in normal mode with sample content. Verify the title bar displays ' +
    'the title and close button, all 8 resize edge/corner zones are present, and ' +
    'the edge expand button is visible on the left edge.',
  grepTerms: [
    'PaneChrome',
    'ChromeProps',
    'usePointerDrag',
    '.panel-chrome',
    '.panel-chrome--pane',
    '.panel-chrome-title-bar',
    '.panel-chrome-content',
    '.pane-resize-zone',
    '.pane-edge-expand-btn',
    '.pane-edge-caret',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a' }}>
        <PaneChrome panelId="inspector-pane" title="Settings" onClose={() => console.log('[Inspector] close')}>
          <div style={{ padding: '1rem', color: '#a0a0c0' }}>
            <p>Sample panel content rendered inside PaneChrome.</p>
            <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
              Try dragging the title bar to move, edges to resize, or the left-edge button to expand.
            </p>
          </div>
        </PaneChrome>
      </div>
    ),
    loadAppStyles: true,
    width: 800,
    height: 600,
  },
});
