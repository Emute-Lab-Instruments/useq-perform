import { createSignal, Show } from "solid-js";
import { Section } from "./FormControls";
import { getStartupFlagsSnapshot } from "../../runtime/startupContext.ts";

type ConfigurationManagementProps = {
  devmode?: boolean;
  onReload?: () => void;
};

async function loadConfigManager() {
  return import("../../runtime/configManager.ts");
}

/** Export settings as a JSON file download. Available to all users. */
export function handleSettingsExport() {
  return async () => {
    try {
      const { exportConfiguration } = await loadConfigManager();
      const config = exportConfiguration({ includeCode: false, includeDevMode: false });
      const jsonString = JSON.stringify(config, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `useq-settings-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      console.error("Export error:", error);
      alert(`Failed to export settings:\n${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

/** Import settings from a JSON file. Available to all users. */
export function handleSettingsImport(onReload: () => void) {
  return async () => {
    try {
      const {
        importConfiguration,
        loadConfigurationFromFile,
        previewConfiguration,
      } = await loadConfigManager();
      const config = await loadConfigurationFromFile();
      const preview = previewConfiguration(config);

      let confirmMessage = "Apply this configuration?\n\n";
      if (preview.hasChanges) {
        confirmMessage += "Changes:\n" + preview.diffs.join("\n") + "\n\n";
      } else {
        confirmMessage += "No changes detected.\n\n";
      }
      confirmMessage += "The page will reload to apply changes.";

      if (confirm(confirmMessage)) {
        importConfiguration(config);
        onReload();
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "File selection cancelled") return;
      console.error("Import error:", error);
      alert(`Failed to import settings:\n${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

/**
 * Dev-only section: promote current settings to the shipped defaults
 * by writing them to default-config.json via the config server WebSocket.
 */
export function ConfigurationManagement(props: ConfigurationManagementProps = {}) {
  const devmode = props.devmode ?? getStartupFlagsSnapshot().devmode;

  if (!devmode) {
    return null;
  }

  const [promoting, setPromoting] = createSignal(false);

  const handlePromoteToDefaults = async () => {
    if (!confirm(
      "Promote current settings to shipped defaults?\n\n" +
      "This overwrites src/runtime/default-config.json.\n" +
      "You can then commit the change to ship these defaults to all users."
    )) return;

    setPromoting(true);
    try {
      const { saveConfiguration } = await loadConfigManager();
      const result = await saveConfiguration({
        includeCode: false,
        includeDevMode: true,
      }) as { method: string; path?: string; name?: string };

      if (result.method === "websocket") {
        alert(`Defaults updated:\n${result.path}\n\nCommit this file to ship the new defaults.`);
      } else if (result.method === "filesystem-api") {
        alert(`Saved to: ${result.name}\n\nCopy to src/runtime/default-config.json and commit.`);
      } else if (result.method === "download") {
        alert("Downloaded config file.\n\nReplace src/runtime/default-config.json with it and commit.");
      }
    } catch (error: unknown) {
      console.error("Promote error:", error);
      alert(`Failed to promote defaults:\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Section title="Developer Tools">
      <p class="panel-info-text">
        Promote your current settings as the shipped defaults for all users.
        Requires the config server (runs automatically with <code>npm run dev</code>).
      </p>
      <div class="panel-button-group">
        <button
          class="panel-button"
          onClick={handlePromoteToDefaults}
          disabled={promoting()}
        >
          <Show when={!promoting()} fallback="Saving...">
            Promote to Defaults
          </Show>
        </button>
      </div>
    </Section>
  );
}
