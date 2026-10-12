import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { MainToolbar } from '@src/ui/MainToolbar';

const noop = () => {};

const meta: Meta<typeof MainToolbar> = {
  title: 'Toolbar/Main',
  tags: ['autodocs'],
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
  parameters: { docs: { description: { story: 'Main toolbar when fully disconnected. The connection chip reads "Offline" in the error status colour; no hardware or WASM runtime is active.' } } },
};

export const WasmOnly: Story = {
  args: { connectionState: 'wasm' },
  parameters: { docs: { description: { story: 'Browser-local WASM interpreter only, no hardware connected. The connection chip reads "Virtual uSEQ".' } } },
};

export const ConnectedHardware: Story = {
  args: { connectionState: 'hardware' },
  parameters: { docs: { description: { story: 'Connected to hardware via serial with WASM disabled. The connection chip reads "uSEQ hardware".' } } },
};

export const WithShortcuts: Story = {
  args: { connectionState: 'wasm', shortcuts: { graph: 'Alt+G', help: 'Alt+/' } },
  parameters: { docs: { description: { story: 'Tooltips append the live keybinding for actions that have one (hover Graph or Help).' } } },
};

export const HardwareWithWasmShadow: Story = {
  args: { connectionState: 'both' },
  parameters: { docs: { description: { story: 'Hardware-authoritative output with the Worker WASM visualisation shadow active. The chip reads "Hardware + virtual" and its dot gains a second ring.' } } },
};
