import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { EvalResultsSettings } from '@src/ui/settings/EvalResultsSettings';
import { createStore } from 'solid-js/store';

function EvalResultsSettingsWrapper() {
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
    <EvalResultsSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Eval Results',
  tags: ['autodocs'],
  component: EvalResultsSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
