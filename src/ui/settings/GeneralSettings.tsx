import {
  resetSettings,
} from "../../runtime/runtimeService.ts";
import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore.ts";
import { PersonalSettings } from "./PersonalSettings";
import { EditorSettings } from "./EditorSettings";
import { EvalResultsSettings } from "./EvalResultsSettings";
import { StorageSettings } from "./StorageSettings";
import { UISettings } from "./UISettings";
import { VisualisationSettings } from "./VisualisationSettings";
import { ConfigurationManagement, handleSettingsExport, handleSettingsImport } from "./ConfigurationManagement";
import { ConsoleSettings } from "./ConsoleSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface GeneralSettingsProps {
  /** Current settings object. Defaults to the global reactive settings store. */
  settings?: AppSettings;
  /** Callback to apply a partial settings update. Defaults to requestSettingsUpdate. */
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
  /** Callback to reset all settings. Defaults to runtimeService.resetSettings. */
  onResetSettings?: () => void;
  /** Callback invoked after reset or import when a page reload is needed. Defaults to window.location.reload. */
  onReload?: () => void;
}

export function GeneralSettings(props: GeneralSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);
  const reload = () => (props.onReload ?? (() => window.location.reload()))();

  const handleReset = () => {
    if (confirm("Are you sure you want to reset all settings to default values?")) {
      (props.onResetSettings ?? resetSettings)();
      reload();
    }
  };

  return (
    <div class="panel-tab-content">
      <PersonalSettings settings={s()} onUpdateSettings={update} />
      <EditorSettings settings={s()} onUpdateSettings={update} />
      <ConsoleSettings settings={s()} onUpdateSettings={update} />
      <EvalResultsSettings settings={s()} onUpdateSettings={update} />
      <StorageSettings settings={s()} onUpdateSettings={update} />
      <UISettings settings={s()} onUpdateSettings={update} />
      <VisualisationSettings settings={s()} onUpdateSettings={update} />
      <AdvancedSettings settings={s()} onUpdateSettings={update} />
      <ConfigurationManagement onReload={reload} />

      <div class="settings-footer">
        <div class="settings-footer-group">
          <button class="panel-button" onClick={handleSettingsExport()}>
            Export settings
          </button>
          <button class="panel-button" onClick={handleSettingsImport(reload)}>
            Import settings
          </button>
        </div>
        <button class="panel-button reset" onClick={handleReset}>
          Reset all settings
        </button>
      </div>
    </div>
  );
}
