import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { GeneralSettings } from '@src/ui/settings/GeneralSettings';
import { setSettingsQuery } from '@src/ui/settings/settingsSearch';
import { createStore } from 'solid-js/store';
import { onMount } from 'solid-js';

function SettingsSearchWrapper() {
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

  onMount(() => {
    setSettingsQuery('font');
  });

  return (
    <GeneralSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
      onResetSettings={() => {
        console.log('[Storybook] Reset settings (no-op)');
      }}
      getSettingsSnapshot={() => settings}
      onImportSettings={(data) => {
        console.log('[Storybook] Import settings:', data);
      }}
      onReload={() => {
        console.log('[Storybook] Reload requested (no-op)');
      }}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Search',
  tags: ['autodocs'],
  component: SettingsSearchWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
