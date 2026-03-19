import { resetSettings } from "../../runtime/runtimeService.ts";
import { PersonalSettings } from "./PersonalSettings";
import { EditorSettings } from "./EditorSettings";
import { StorageSettings } from "./StorageSettings";
import { UISettings } from "./UISettings";
import { VisualisationSettings } from "./VisualisationSettings";
import { ConfigurationManagement } from "./ConfigurationManagement";
import { AdvancedSettings } from "./AdvancedSettings";

export function GeneralSettings() {
  const handleReset = () => {
    if (confirm("Are you sure you want to reset all settings to default values?")) {
      resetSettings();
      window.location.reload();
    }
  };

  return (
    <div class="panel-tab-content">
      <PersonalSettings />
      <EditorSettings />
      <StorageSettings />
      <UISettings />
      <VisualisationSettings />
      <AdvancedSettings />
      <ConfigurationManagement />
      
      <div class="panel-section">
        <button class="panel-button reset" onClick={handleReset}>
          Reset All Settings
        </button>
      </div>
    </div>
  );
}
