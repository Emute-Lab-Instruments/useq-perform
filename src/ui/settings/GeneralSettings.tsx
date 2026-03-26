import { resetSettings, getSettings, updateSettings } from "../../runtime/runtimeService.ts";
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

export function GeneralSettings() {
  // Clear search when leaving the settings panel
  onCleanup(() => setSettingsQuery(""));

  const handleReset = () => {
    if (confirm("Are you sure you want to reset all settings to default values?")) {
      resetSettings();
      window.location.reload();
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(getSettings(), null, 2);
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
          updateSettings(parsed);
          window.location.reload();
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

      <PersonalSettings />
      <EditorSettings />
      <EvalResultsSettings />
      <StorageSettings />
      <UISettings />
      <VisualisationSettings />
      <AdvancedSettings />
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
