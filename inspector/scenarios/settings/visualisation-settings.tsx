import { defineScenario } from '../../framework/scenario';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { VisualisationSettings } from '@src/ui/settings/VisualisationSettings';
import { setDevmodeOverride } from '@src/ui/settings/devmodeContext';
import { createStore } from 'solid-js/store';

export default defineScenario({
  category: 'Settings UI / Visualisation Settings',
  name: 'All controls (devmode)',
  type: 'contract',
  sourceFiles: ['src/ui/settings/VisualisationSettings.tsx'],
  description:
    'Visualisation settings panel with devmode enabled, showing all sub-groups. ' +
    'Basic-only mode hides probes, readability, future region, plus several waveform tuning knobs.',
  component: {
    render: () => {
      // Force devmode so advanced sub-groups (Probes / Readability / Future region) render.
      setDevmodeOverride(true);
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
    },
    loadAppStyles: true,
    width: 400,
    height: 500,
  },
});
