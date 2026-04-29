import { defineScenario } from '../../framework/scenario';
import { createDefaultUserSettings } from '@src/lib/appSettings';
import { EditorSettings } from '@src/ui/settings/EditorSettings';
import { setDevmodeOverride } from '@src/ui/settings/devmodeContext';
import { createStore } from 'solid-js/store';

export default defineScenario({
  category: 'Settings UI / Editor Settings',
  name: 'Editor preferences (devmode)',
  type: 'contract',
  sourceFiles: ['src/ui/settings/EditorSettings.tsx'],
  description:
    'Editor settings panel with devmode enabled, showing theme selector, font size ' +
    '(drag-to-adjust), and bracket unbalancing toggle. The bracket toggle is advanced; ' +
    'in basic-only mode only theme + font size remain.',
  component: {
    render: () => {
      // Show advanced controls so the bracket-unbalancing toggle is visible.
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
        <EditorSettings
          settings={settings}
          onUpdateSettings={handleUpdate}
          themeNames={['uSEQ Dark', 'uSEQ Light', 'Ember', 'Glacier', 'Moss']}
          onApplyTheme={() => {}}
          onApplyFontSize={() => {}}
        />
      );
    },
    loadAppStyles: true,
    width: 400,
    height: 400,
  },
});
