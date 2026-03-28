import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { EditorSettings } from '@src/ui/settings/EditorSettings';
import { createStore } from 'solid-js/store';

function EditorSettingsWrapper() {
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
    <EditorSettings
      settings={settings}
      onUpdateSettings={handleUpdate}
      themeNames={['uSEQ Dark', 'uSEQ Light', 'Ember', 'Glacier', 'Moss']}
      onApplyTheme={() => {}}
      onApplyFontSize={() => {}}
    />
  );
}

const meta: Meta = {
  title: 'Settings/Editor',
  tags: ['autodocs'],
  component: EditorSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
