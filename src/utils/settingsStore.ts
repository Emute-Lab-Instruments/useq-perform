import { createStore, reconcile } from "solid-js/store";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { settingsChanged } from "../contracts/runtimeChannels.ts";
import { updateSettings } from "../runtime/runtimeService.ts";
import { createDefaultUserSettings, mergeUserSettings, type AppSettings } from "../lib/appSettings.ts";
import { setMaxConsoleLines } from "./consoleStore.ts";

/**
 * SolidJS reactive store for user settings.
 * Syncs with the canonical appSettingsRepository via the settingsChanged
 * typed channel (published by runtimeService after every mutation).
 */
export const [settings, setSettings] = createStore<AppSettings>(
  mergeUserSettings(createDefaultUserSettings(), getAppSettings()),
);

/**
 * Updates user settings and ensures they are persisted and the store is updated.
 * Routes through runtimeService — the sole mutation surface for settings.
 * @param values Partial settings object to merge into the active settings
 */
export function updateSettingsStore(values: Record<string, unknown>) {
  updateSettings(values);
}

function syncSettingsStore(nextSettings: AppSettings): void {
  setSettings(reconcile(mergeUserSettings(createDefaultUserSettings(), nextSettings)));
  if (nextSettings?.ui?.consoleLinesLimit) {
    setMaxConsoleLines(nextSettings.ui.consoleLinesLimit);
  }
}

// Subscribe to settings changes via the typed channel published by runtimeService.
if (typeof window !== "undefined") {
  syncSettingsStore(getAppSettings());
  settingsChanged.subscribe(syncSettingsStore);
}
