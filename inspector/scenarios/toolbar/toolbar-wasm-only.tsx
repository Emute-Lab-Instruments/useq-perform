import { defineScenario } from '../../framework/scenario';
import { MainToolbar } from '@src/ui/MainToolbar';

const noop = () => {};

export default defineScenario({
  category: 'Toolbar & Chrome / Main Toolbar',
  name: 'WASM interpreter only',
  type: 'contract',
  sourceFiles: [
    'src/ui/MainToolbar.tsx',
  ],
  description: 'Main toolbar when running in browser-local mode with WASM interpreter only, no hardware connected. Connect button should show cyan transport-wasm styling.',
  component: {
    render: () => (
      <div style={{ background: '#1e293b', padding: '20px' }}>
        <MainToolbar
          connectionState="wasm"
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
