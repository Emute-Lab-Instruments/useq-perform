import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { VisualisationSettings } from '@src/ui/settings/VisualisationSettings';
import { createStore } from 'solid-js/store';

function VisualisationSettingsWrapper() {
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
    <VisualisationSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Visualisation',
  component: VisualisationSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
