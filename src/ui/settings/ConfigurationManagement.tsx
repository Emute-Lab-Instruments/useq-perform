import { createSignal, Show } from "solid-js";
import { Section } from "./FormControls";
import { getStartupFlagsSnapshot } from "../../runtime/startupContext.ts";
import { notify as globalNotify, type ToastRequest } from "../../contracts/toastChannels.ts";
import { confirmDialog, type ConfirmDialogFn } from "../adapters/modal";

/** Injectable dialog/notification capabilities (defaults: in-app modal + toast). */
export interface ConfigurationDialogs {
  confirm?: ConfirmDialogFn;
  notify?: (request: ToastRequest) => void;
}

type ConfigurationManagementProps = ConfigurationDialogs & {
  devmode?: boolean;
  onReload?: () => void;
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function loadConfigManager() {
  return import("../../runtime/configManager.ts");
}

/** Export settings as a JSON file download. Available to all users. */
export function handleSettingsExport(dialogs: ConfigurationDialogs = {}) {
  const notify = dialogs.notify ?? globalNotify;
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
      notify({ kind: "error", message: `Failed to export settings: ${errorText(error)}` });
    }
  };
}

/** Import settings from a JSON file. Available to all users. */
export function handleSettingsImport(onReload: () => void, dialogs: ConfigurationDialogs = {}) {
  const confirmAction = dialogs.confirm ?? confirmDialog;
  const notify = dialogs.notify ?? globalNotify;
  return async () => {
    try {
      const {
        importConfiguration,
        loadConfigurationFromFile,
        previewConfiguration,
      } = await loadConfigManager();
      const config = await loadConfigurationFromFile();
      const preview = previewConfiguration(config);

      let confirmMessage = preview.hasChanges
        ? "Changes:\n" + preview.diffs.join("\n") + "\n\n"
        : "No changes detected.\n\n";
      confirmMessage += "The page will reload to apply changes.";

      const ok = await confirmAction({
        title: "Apply this configuration?",
        message: confirmMessage,
        confirmLabel: "Apply and reload",
      });
      if (ok) {
        importConfiguration(config);
        onReload();
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "File selection cancelled") return;
      console.error("Import error:", error);
      notify({ kind: "error", message: `Failed to import settings: ${errorText(error)}` });
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
  const confirmAction = props.confirm ?? confirmDialog;
  const notify = props.notify ?? globalNotify;

  const handlePromoteToDefaults = async () => {
    const ok = await confirmAction({
      title: "Promote to shipped defaults?",
      message:
        "This overwrites src/runtime/default-config.json.\n" +
        "You can then commit the change to ship these defaults to all users.",
      confirmLabel: "Overwrite defaults",
      destructive: true,
    });
    if (!ok) return;

    setPromoting(true);
    try {
      const { saveConfiguration } = await loadConfigManager();
      const result = await saveConfiguration({
        includeCode: false,
        includeDevMode: true,
      }) as { method: string; path?: string; name?: string };

      // Success toasts carry follow-up instructions, so they linger longer.
      const durationMs = 8000;
      if (result.method === "websocket") {
        notify({ kind: "success", durationMs, message: `Defaults updated: ${result.path}\nCommit this file to ship the new defaults.` });
      } else if (result.method === "filesystem-api") {
        notify({ kind: "success", durationMs, message: `Saved to: ${result.name}\nCopy to src/runtime/default-config.json and commit.` });
      } else if (result.method === "download") {
        notify({ kind: "success", durationMs, message: "Downloaded config file.\nReplace src/runtime/default-config.json with it and commit." });
      }
    } catch (error: unknown) {
      console.error("Promote error:", error);
      notify({ kind: "error", message: `Failed to promote defaults: ${errorText(error)}` });
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
