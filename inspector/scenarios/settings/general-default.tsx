import { defineScenario } from '../../framework/scenario';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { GeneralSettings } from '@src/ui/settings/GeneralSettings';
import { setDevmodeOverride } from '@src/ui/settings/devmodeContext';
import { createStore } from 'solid-js/store';

export default defineScenario({
  category: 'Settings UI / General Settings',
  name: 'Basic surface (no devmode)',
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
    'src/ui/settings/devmodeContext.ts',
  ],
  description:
    'General settings panel with devmode OFF — only basic-tagged fields render. ' +
    'The Advanced section, Readability/Future-region/Probes sub-groups, and most ' +
    'tuning knobs should be hidden. Export/Import/Reset are always visible.',
  component: {
    render: () => {
      // Make sure no prior scenario left devmode enabled.
      setDevmodeOverride(false);
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
