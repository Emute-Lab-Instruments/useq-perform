import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ConfigurationManagement } from '@src/ui/settings/ConfigurationManagement';

function ConfigurationManagementWrapper() {
  return (
    <ConfigurationManagement
      devmode={true}
      onReload={() => {}}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Configuration Management',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const DevToolsVisible: Story = {
  render: () => (
    <ConfigurationManagement
      devmode={true}
      onReload={() => {}}
    />
  ),
};

export const NonDevHidden: Story = {
  render: () => (
    <div>
      <p style={{ color: '#808098', 'font-size': '0.85rem', 'margin-bottom': '0.5rem' }}>
        When devmode is false (the default), ConfigurationManagement renders nothing:
      </p>
      <div style={{ border: '1px dashed #444', padding: '0.5rem', 'border-radius': '4px' }}>
        <ConfigurationManagement devmode={false} onReload={() => {}} />
      </div>
    </div>
  ),
};
