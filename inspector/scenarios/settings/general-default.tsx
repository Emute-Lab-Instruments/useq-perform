import { defineScenario } from '../../framework/scenario';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { GeneralSettings } from '@src/ui/settings/GeneralSettings';
import { createStore } from 'solid-js/store';

export default defineScenario({
  category: 'Settings UI / General Settings',
  name: 'Default state',
  type: 'contract',
  sourceFiles: [
    'src/ui/settings/GeneralSettings.tsx',
    'src/ui/settings/PersonalSettings.tsx',
    'src/ui/settings/EditorSettings.tsx',
    'src/ui/settings/EvalResultsSettings.tsx',
    'src/ui/settings/StorageSettings.tsx',
    'src/ui/settings/UISettings.tsx',
    'src/ui/settings/VisualisationSettings.tsx',
    'src/ui/settings/AdvancedSettings.tsx',
    'src/ui/settings/FormControls.tsx',
  ],
  description:
    'General settings panel rendered with default values and no-op callbacks. ' +
    'All sub-panels should display with their default control values. ' +
    'Export/Import/Reset buttons should be visible at the bottom.',
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
