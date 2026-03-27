import { defineScenario } from '../../framework/scenario';
import { MainToolbar } from '@src/ui/MainToolbar';

const noop = () => {};

export default defineScenario({
  category: 'Toolbar & Chrome / Main Toolbar',
  name: 'Connected to hardware',
  type: 'contract',
  sourceFiles: [
    'src/ui/MainToolbar.tsx',
  ],
  description: 'Main toolbar when connected to hardware via serial. Connect button should show blue transport-hardware styling with active cable icon.',
  grepTerms: ['MainToolbar', 'MainToolbarProps', 'ConnectionState', 'transport-hardware', '.toolbar-button'],
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '20px' }}>
        <MainToolbar
          connectionState="hardware"
          onConnect={noop}
          onToggleGraph={noop}
          onLoadCode={noop}
          onSaveCode={noop}
          onFontSizeUp={noop}
          onFontSizeDown={noop}
          onSettings={noop}
          onHelp={noop}
        />
      </div>
    ),
    loadAppStyles: true,
    width: 800,
    height: 120,
  },
});
