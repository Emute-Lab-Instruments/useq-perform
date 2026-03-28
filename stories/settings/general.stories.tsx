import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { GeneralSettings } from '@src/ui/settings/GeneralSettings';
import { createStore } from 'solid-js/store';

function GeneralSettingsWrapper() {
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
    <GeneralSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
      onResetSettings={() => {}}
      getSettingsSnapshot={() => settings}
      onImportSettings={() => {}}
      onReload={() => {}}
    />
  );
}

const meta: Meta = {
  title: 'Settings/General',
  component: GeneralSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
