import { saveConfiguration, loadConfigurationFromFile, previewConfiguration, importConfiguration } from "../../legacy/config/configManager.ts";
import { Section } from "./FormControls";

export function ConfigurationManagement() {
  const handleExport = async () => {
    try {
      const result = await saveConfiguration({
        includeCode: false,
        includeDevMode: window.location.search.includes('devmode=true')
      });

      if (result.method === 'websocket') {
        alert(`✅ Configuration saved to:\n${result.path}\n\nYou can now commit this file to git!`);
      } else if (result.method === 'filesystem-api') {
        alert(`✅ Configuration saved to:\n${result.name}`);
      } else if (result.method === 'download') {
        alert('⬇️ Configuration downloaded.\n\nCopy the file to:\nsrc/config/default-config.json\n\nto make changes persist across builds.');
      }
    } catch (error: unknown) {
      console.error('Export error:', error);
      alert(`❌ Failed to export configuration:\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleImport = async () => {
    try {
      const config = await loadConfigurationFromFile();
      const preview = previewConfiguration(config);

      let confirmMessage = 'Apply this configuration?\n\n';
      if (preview.hasChanges) {
        confirmMessage += 'Changes:\n' + preview.diffs.join('\n') + '\n\n';
      } else {
        confirmMessage += 'No changes detected.\n\n';
      }
      confirmMessage += 'The page will reload to apply changes.';

      if (confirm(confirmMessage)) {
        importConfiguration(config);
        window.location.reload();
      }
    } catch (error: unknown) {
      console.error('Import error:', error);
      alert(`❌ Failed to import configuration:\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <Section title="Configuration Management">
      <p class="panel-info-text">
        Export your current settings to a file, or import settings from a previously saved configuration.
        In dev mode with the config server running, configurations can be saved directly to the source directory.
      </p>
      <div class="panel-button-group">
        <button class="panel-button" onClick={handleExport}>
          💾 Export Configuration
        </button>
        <button class="panel-button" onClick={handleImport}>
          📥 Import Configuration
        </button>
      </div>
    </Section>
  );
}
