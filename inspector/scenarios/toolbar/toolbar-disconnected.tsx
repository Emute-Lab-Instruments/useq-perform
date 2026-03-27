import { defineScenario } from '../../framework/scenario';
import { MainToolbar } from '@src/ui/MainToolbar';

const noop = () => {};

export default defineScenario({
  category: 'Toolbar & Chrome / Main Toolbar',
  name: 'Disconnected state',
  type: 'contract',
  sourceFiles: [
    'src/ui/MainToolbar.tsx',
  ],
  description: 'Main toolbar when fully disconnected. Connect button should show gray transport-none styling. No hardware or WASM connection active.',
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '20px' }}>
        <MainToolbar
          connectionState="none"
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
