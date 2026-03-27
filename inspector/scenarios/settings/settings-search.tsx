import { defineScenario } from '../../framework/scenario';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { GeneralSettings } from '@src/ui/settings/GeneralSettings';
import { setSettingsQuery } from '@src/ui/settings/settingsSearch';
import { createStore } from 'solid-js/store';
import { onMount } from 'solid-js';

export default defineScenario({
  category: 'Settings UI',
  name: 'Settings search filtering',
  type: 'canary',
  sourceFiles: ['src/ui/settings/settingsSearch.ts', 'src/ui/settings/GeneralSettings.tsx'],
  description:
    'Settings panel with "font" pre-filled in the search bar. ' +
    'Matching rows should be visible with sections auto-expanded; ' +
    'non-matching rows should be hidden.',
  component: {
    render: () => {
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
            console.log('[Inspector] Reset settings (no-op)');
          }}
          getSettingsSnapshot={() => settings}
          onImportSettings={(data) => {
            console.log('[Inspector] Import settings:', data);
          }}
          onReload={() => {
            console.log('[Inspector] Reload requested (no-op)');
          }}
        />
      );
    },
    loadAppStyles: true,
    width: 500,
    height: 800,
  },
});
