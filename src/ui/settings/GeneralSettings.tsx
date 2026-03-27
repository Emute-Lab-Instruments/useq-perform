import {
  resetSettings,
  getSettings,
  updateSettings,
} from "../../runtime/runtimeService.ts";
import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore.ts";
import { settingsQuery, setSettingsQuery } from "./settingsSearch";
import { PersonalSettings } from "./PersonalSettings";
import { EditorSettings } from "./EditorSettings";
import { EvalResultsSettings } from "./EvalResultsSettings";
import { StorageSettings } from "./StorageSettings";
import { UISettings } from "./UISettings";
import { VisualisationSettings } from "./VisualisationSettings";
import { ConfigurationManagement } from "./ConfigurationManagement";
import { AdvancedSettings } from "./AdvancedSettings";
import { onCleanup } from "solid-js";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface GeneralSettingsProps {
  /** Current settings object. Defaults to the global reactive settings store. */
  settings?: AppSettings;
  /** Callback to apply a partial settings update. Defaults to updateSettingsStore. */
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
  /** Callback to reset all settings. Defaults to runtimeService.resetSettings. */
  onResetSettings?: () => void;
  /** Callback to get the current settings snapshot for export. Defaults to runtimeService.getSettings. */
  getSettingsSnapshot?: () => AppSettings;
  /** Callback to apply bulk-imported settings. Defaults to runtimeService.updateSettings. */
  onImportSettings?: (data: unknown) => void;
  /** Callback invoked after reset or import when a page reload is needed. Defaults to window.location.reload. */
  onReload?: () => void;
}

export function GeneralSettings(props: GeneralSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  // Clear search when leaving the settings panel
  onCleanup(() => setSettingsQuery(""));

  const handleReset = () => {
    if (confirm("Are you sure you want to reset all settings to default values?")) {
      (props.onResetSettings ?? resetSettings)();
      (props.onReload ?? (() => window.location.reload()))();
    }
  };

  const handleExport = () => {
    const snapshot = (props.getSettingsSnapshot ?? getSettings)();
    const data = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `useq-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null) {
          alert("Invalid settings file: expected a JSON object.");
          return;
        }
        if (confirm("Apply imported settings? The page will reload.")) {
          (props.onImportSettings ?? updateSettings)(parsed);
          (props.onReload ?? (() => window.location.reload()))();
        }
      } catch (e) {
        alert(`Failed to read settings file:\n${e instanceof Error ? e.message : String(e)}`);
      }
    };
    input.click();
  };

  return (
    <div class="panel-tab-content">
      <div class="settings-search-bar">
        <input
          type="text"
          class="settings-search-input"
          placeholder="Search settings..."
          value={settingsQuery()}
          onInput={(e) => setSettingsQuery(e.currentTarget.value)}
        />
      </div>

      <PersonalSettings settings={s()} onUpdateSettings={update} />
      <EditorSettings settings={s()} onUpdateSettings={update} />
      <EvalResultsSettings settings={s()} onUpdateSettings={update} />
      <StorageSettings settings={s()} onUpdateSettings={update} />
      <UISettings settings={s()} onUpdateSettings={update} />
      <VisualisationSettings settings={s()} onUpdateSettings={update} />
      <AdvancedSettings settings={s()} onUpdateSettings={update} />
      <ConfigurationManagement />

      <div class="settings-footer">
        <div class="settings-footer-group">
          <button class="panel-button" onClick={handleExport}>
            Export settings
          </button>
          <button class="panel-button" onClick={handleImport}>
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
