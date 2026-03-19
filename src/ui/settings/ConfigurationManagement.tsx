import { Section } from "./FormControls";
import { getStartupFlagsSnapshot } from "../../runtime/startupContext.ts";

type ConfigurationManagementProps = {
  devmode?: boolean;
};

async function loadConfigManager() {
  return import("../../runtime/configManager.ts");
}

export function ConfigurationManagement(props: ConfigurationManagementProps = {}) {
  const devmode = props.devmode ?? getStartupFlagsSnapshot().devmode;

  if (!devmode) {
    return null;
  }

  const handleExport = async () => {
    try {
      const { saveConfiguration } = await loadConfigManager();
      const result = await saveConfiguration({
        includeCode: false,
        includeDevMode: devmode,
      });

      if (result.method === 'websocket') {
        alert(`✅ Configuration saved to:\n${result.path}\n\nYou can now commit this file to git!`);
      } else if (result.method === 'filesystem-api') {
        alert(`✅ Configuration saved to:\n${result.name}`);
      } else if (result.method === 'download') {
        alert('⬇️ Configuration downloaded.\n\nCopy the file to:\nsrc/runtime/default-config.json\n\nto make changes persist across builds.');
      }
    } catch (error: unknown) {
      console.error('Export error:', error);
      alert(`❌ Failed to export configuration:\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleImport = async () => {
    try {
      const {
        importConfiguration,
        loadConfigurationFromFile,
        previewConfiguration,
      } = await loadConfigManager();
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
        Internal dev tooling for exporting or importing configuration files.
        In dev mode with the config server running, configurations can also be written directly to the source tree.
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
