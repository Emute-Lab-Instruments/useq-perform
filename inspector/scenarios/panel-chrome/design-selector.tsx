import { defineScenario } from '../../framework/scenario';
import { DesignSelector } from '@src/ui/panel-chrome/DesignSelector';

export default defineScenario({
  category: 'Toolbar & Chrome / Panel Chrome',
  name: 'Design selector widget',
  type: 'contract',
  sourceFiles: [
    'src/ui/panel-chrome/DesignSelector.tsx',
    'src/ui/panel-chrome/types.ts',
  ],
  description:
    'Standalone DesignSelector widget with devmode enabled. Shows three buttons (pane, drawer, tile) ' +
    'for switching the global chrome design. The active design button should have the "active" class. ' +
    'Clicking a button switches the activeChromeDesign signal.',
  grepTerms: [
    'DesignSelector',
    'activeChromeDesign',
    'setActiveChromeDesign',
    'ChromeDesign',
    '.design-selector',
  ],
  component: {
    render: () => (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a', display: 'flex', 'align-items': 'flex-end', padding: '1rem' }}>
        <DesignSelector devmode={true} />
      </div>
    ),
    loadAppStyles: true,
    width: 400,
    height: 200,
  },
});
