import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { MainToolbar } from '@src/ui/MainToolbar';

const noop = () => {};

const meta: Meta<typeof MainToolbar> = {
  title: 'Toolbar/Main',
  component: MainToolbar,
  decorators: [
    (Story) => (
      <div style={{ background: '#1e293b', padding: '1rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onConnect: noop,
    onToggleGraph: noop,
    onLoadCode: noop,
    onSaveCode: noop,
    onFontSizeUp: noop,
    onFontSizeDown: noop,
    onSettings: noop,
    onHelp: noop,
  },
};
export default meta;
type Story = StoryObj<typeof MainToolbar>;

export const Disconnected: Story = {
  args: { connectionState: 'none' },
  parameters: { docs: { description: { story: 'Main toolbar when fully disconnected. Connect button shows gray transport-none styling. No hardware or WASM connection active.' } } },
};

export const WasmOnly: Story = {
  args: { connectionState: 'wasm' },
  parameters: { docs: { description: { story: 'Main toolbar when running in browser-local mode with WASM interpreter only, no hardware connected. Connect button shows cyan transport-wasm styling.' } } },
};

export const ConnectedHardware: Story = {
  args: { connectionState: 'hardware' },
  parameters: { docs: { description: { story: 'Main toolbar when connected to hardware via serial. Connect button shows blue transport-hardware styling with active cable icon.' } } },
};
