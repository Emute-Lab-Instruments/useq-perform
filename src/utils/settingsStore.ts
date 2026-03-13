import { createStore, reconcile } from "solid-js/store";
import {
  getAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../runtime/appSettingsRepository.ts";
import { createDefaultUserSettings, mergeUserSettings, type AppSettings } from "../legacy/config/appSettings.ts";

/**
 * SolidJS store for user settings.
 * Wraps the legacy activeUserSettings and provides reactivity.
 */
export const [settings, setSettings] = createStore<AppSettings>(
  mergeUserSettings(createDefaultUserSettings(), getAppSettings()),
);

/**
 * Updates user settings and ensures they are persisted and the store is updated.
 * @param values Partial settings object to merge into the active settings
 */
export function updateSettingsStore(values: Record<string, unknown>) {
  updateAppSettings(values);
}

function syncSettingsStore(nextSettings: AppSettings): void {
  setSettings(reconcile(mergeUserSettings(createDefaultUserSettings(), nextSettings)));
}

// Sync store with the canonical repository while legacy listeners remain supported.
if (typeof window !== "undefined") {
  syncSettingsStore(getAppSettings());
  subscribeAppSettings(syncSettingsStore);
}
