import { defineScenario } from '../../framework/scenario';
import { PanelChrome } from '@src/ui/panel-chrome/PanelChrome';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Pane — expanded (90% viewport)',
  type: 'canary',
  sourceFiles: [
    'src/ui/panel-chrome/PaneChrome.tsx',
    'src/ui/panel-chrome/PanelChrome.tsx',
    'src/ui/panel-chrome/types.ts',
  ],
  description:
    'PanelChrome with design="pane" at its default size. The expanded state (90% viewport) ' +
    'is triggered by clicking the left-edge expand button. Verify the pane renders at its ' +
    'normal default size and that the edge expand caret points left (indicating it can expand).',
  grepTerms: [
    'PanelChrome',
    'PanelChromeProps',
    'PaneChrome',
    'toggleExpand',
    '.panel-chrome--pane',
    '.pane-edge-expand-btn',
    '.pane-edge-caret--left',
    '.pane-edge-caret--right',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a' }}>
        <PanelChrome design="pane" panelId="inspector-pane-expand" title="Help" onClose={() => console.log('[Inspector] close')}>
          <div style={{ padding: '1rem', color: '#a0a0c0' }}>
            <p>Click the left-edge caret button to toggle expanded mode (90% viewport).</p>
            <p>When expanded, the caret should flip direction.</p>
          </div>
        </PanelChrome>
      </div>
    ),
    loadAppStyles: true,
    width: 900,
    height: 700,
  },
});
