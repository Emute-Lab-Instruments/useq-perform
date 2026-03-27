import { defineScenario } from '../../framework/scenario';
import { PanelChrome } from '@src/ui/panel-chrome/PanelChrome';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Drawer — collapsed (vertical tab)',
  type: 'canary',
  sourceFiles: [
    'src/ui/panel-chrome/DrawerChrome.tsx',
    'src/ui/panel-chrome/PanelChrome.tsx',
    'src/ui/panel-chrome/types.ts',
  ],
  description:
    'DrawerChrome rendered via PanelChrome with design="drawer". The collapsed state ' +
    'is triggered by clicking the collapse button (<<). In its default state, the drawer ' +
    'shows the full panel. Click the collapse button to see it minimize to a vertical tab.',
  grepTerms: [
    'DrawerChrome',
    'PanelChrome',
    '.panel-chrome--drawer',
    '.drawer-collapsed-tab',
    'collapse',
    'restore',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a', display: 'flex', 'justify-content': 'flex-end' }}>
        <PanelChrome design="drawer" panelId="inspector-drawer-collapse" title="Help" onClose={() => console.log('[Inspector] close')}>
          <div style={{ padding: '1rem', color: '#a0a0c0' }}>
            <p>Click the collapse button (&laquo;) in the title bar to minimize this drawer to a vertical tab.</p>
            <p>Click the vertical tab to restore the drawer.</p>
          </div>
        </PanelChrome>
      </div>
    ),
    loadAppStyles: true,
    width: 900,
    height: 600,
  },
});
