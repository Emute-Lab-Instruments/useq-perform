import { defineScenario } from '../../framework/scenario';
import { TileChrome } from '@src/ui/panel-chrome/TileChrome';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Tile — right-third slot',
  type: 'contract',
  sourceFiles: [
    'src/ui/panel-chrome/TileChrome.tsx',
    'src/ui/panel-chrome/types.ts',
  ],
  description:
    'TileChrome in its default right-third snap position (67vw, 5vh, 31vw x 90vh). ' +
    'Verify the title bar has layout picker, collapse, expand, and close buttons. ' +
    'Click the layout button (grid icon) to open the slot picker popover with 6 miniature previews.',
  grepTerms: [
    'TileChrome',
    'TileSlot',
    'SLOT_GEOMETRIES',
    'SLOT_PREVIEWS',
    '.panel-chrome--tile',
    '.tile-layout-picker',
    '.tile-layout-picker-item',
    '.slot-preview',
    '.tile-collapsed-chip',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a' }}>
        <TileChrome panelId="inspector-tile" title="Settings" onClose={() => console.log('[Inspector] close')}>
          <div style={{ padding: '1rem', color: '#a0a0c0' }}>
            <p>Tile panel in right-third slot.</p>
            <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
              Click the grid button in the title bar to see the layout picker with 6 snap positions.
            </p>
          </div>
        </TileChrome>
      </div>
    ),
    loadAppStyles: true,
    width: 900,
    height: 700,
  },
});
