import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { SettingsPanel } from '@src/ui/settings/SettingsPanel';
import { ConfigurationManagement } from '@src/ui/settings/ConfigurationManagement';

const meta: Meta = {
  title: 'Settings/Panel',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

/**
 * Top-level settings orchestrator — Tabs around General / Themes / Keybindings.
 * Each tab uses its own props-or-store fallback, so the panel renders against
 * the live settings store with default values.
 */
export const Full: Story = {
  render: () => (
    <div style={{ width: '100%', 'max-width': '800px', height: '720px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      <SettingsPanel />
    </div>
  ),
};

/** Configuration management section — export/import/reset buttons. */
export const ConfigManagement: Story = {
  render: () => (
    <div style={{ width: '100%', 'max-width': '600px', background: '#0b1220', padding: '16px' }}>
      <ConfigurationManagement
        devmode={false}
        onReload={() => alert('Reload triggered')}
      />
    </div>
  ),
};

/** Configuration management with developer-mode controls visible. */
export const ConfigManagementDevmode: Story = {
  render: () => (
    <div style={{ width: '100%', 'max-width': '600px', background: '#0b1220', padding: '16px' }}>
      <ConfigurationManagement
        devmode={true}
        onReload={() => alert('Reload triggered')}
      />
    </div>
  ),
};
