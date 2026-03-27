import { defineScenario } from '../../framework/scenario';
import { PanelChrome } from '@src/ui/panel-chrome/PanelChrome';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Tile — center-large (expanded)',
  type: 'canary',
  sourceFiles: [
    'src/ui/panel-chrome/TileChrome.tsx',
    'src/ui/panel-chrome/PanelChrome.tsx',
    'src/ui/panel-chrome/types.ts',
  ],
  description:
    'TileChrome rendered via PanelChrome with design="tile". Starts at the default ' +
    'right-third slot. Click the expand button to snap to center-large (10vw, 10vh, 80vw x 80vh). ' +
    'Use the layout picker grid icon to switch between all 6 snap positions.',
  grepTerms: [
    'TileChrome',
    'PanelChrome',
    'center-large',
    'toggleExpand',
    'selectSlot',
    '.panel-chrome--tile',
    '.tile-layout-picker',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a' }}>
        <PanelChrome design="tile" panelId="inspector-tile-center" title="Help" onClose={() => console.log('[Inspector] close')}>
          <div style={{ padding: '1rem', color: '#a0a0c0' }}>
            <p>Tile panel starting in right-third slot.</p>
            <p>Click the expand button to snap to center-large position.</p>
            <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
              Use the layout picker to try all 6 tile positions: right-third, right-half, bottom-half, bottom-right, center-large, top-right.
            </p>
          </div>
        </PanelChrome>
      </div>
    ),
    loadAppStyles: true,
    width: 900,
    height: 700,
  },
});
