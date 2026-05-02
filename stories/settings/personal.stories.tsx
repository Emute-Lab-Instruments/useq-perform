import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { PersonalSettings } from '@src/ui/settings/PersonalSettings';
import { createStore } from 'solid-js/store';

function PersonalSettingsWrapper() {
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
    <PersonalSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Personal',
  tags: ['autodocs'],
  component: PersonalSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
