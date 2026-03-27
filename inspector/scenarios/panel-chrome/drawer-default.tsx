import { defineScenario } from '../../framework/scenario';
import { DrawerChrome } from '@src/ui/panel-chrome/DrawerChrome';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Drawer — default (right-aligned)',
  type: 'contract',
  sourceFiles: [
    'src/ui/panel-chrome/DrawerChrome.tsx',
    'src/ui/panel-chrome/types.ts',
    'src/ui/panel-chrome/usePointerDrag.ts',
  ],
  description:
    'DrawerChrome in normal mode, right-aligned at 35% width. Verify the title bar shows ' +
    'collapse (<<), expand, and close buttons. The left-edge resize handle should be visible ' +
    'and draggable to adjust width between 20% and 80%.',
  grepTerms: [
    'DrawerChrome',
    'ChromeProps',
    'ChromeMode',
    '.panel-chrome--drawer',
    '.drawer-resize-edge',
    '.panel-chrome-title-bar',
    '.chrome-btn',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a', display: 'flex', 'justify-content': 'flex-end' }}>
        <DrawerChrome panelId="inspector-drawer" title="Settings" onClose={() => console.log('[Inspector] close')}>
          <div style={{ padding: '1rem', color: '#a0a0c0' }}>
            <p>Drawer panel content, slides in from the right.</p>
            <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
              Drag the left edge to resize. Click collapse button to minimize to a vertical tab.
            </p>
          </div>
        </DrawerChrome>
      </div>
    ),
    loadAppStyles: true,
    width: 900,
    height: 600,
  },
});
