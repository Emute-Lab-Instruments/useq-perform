import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { AdvancedSettings } from '@src/ui/settings/AdvancedSettings';
import { createStore } from 'solid-js/store';

function AdvancedSettingsWrapper() {
  const [settings, setSettings] = createStore(createDefaultUserSettings());

  const handleUpdate = (patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        setSettings(key as any, (prev: any) => ({ ...prev, ...(value as any) }));
      } else {
        setSettings(key as any, value as any);
      }
    }
  };

  return (
    <AdvancedSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Advanced',
  tags: ['autodocs'],
  component: AdvancedSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
