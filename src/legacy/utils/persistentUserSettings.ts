import { dbg } from "../utils.ts";
import {
  type AppSettings,
  clearPersistedUserSettings,
  codeStorageKey,
  createDefaultUserSettings,
  defaultUserSettings,
  mergeUserSettings,
  readPersistedUserSettings,
  settingsStorageKey,
} from "../config/appSettings.ts";
import {
  getAppSettings,
  loadAppSettings,
  replaceAppSettings,
  updateAppSettings,
  subscribeAppSettings,
} from "../../runtime/appSettingsRepository.ts";

export {
  codeStorageKey,
  defaultUserSettings,
  mergeUserSettings,
  readPersistedUserSettings,
  settingsStorageKey,
};

export let activeUserSettings = getAppSettings();
dbg(
  "persistentUserSettings.mjs: Initial active settings theme:",
  activeUserSettings.editor.theme,
);

subscribeAppSettings((settings) => {
  activeUserSettings = settings;
});

export function replaceUserSettings(
  values: unknown,
  options: {
    persist?: boolean;
    dispatch?: boolean;
  } = {},
): AppSettings {
  return replaceAppSettings(values, options);
}

export function loadUserSettings() {
  return loadAppSettings();
}

export function saveUserSettings() {
  dbg(
    "persistentUserSettings.mjs: Saving settings with theme:",
    activeUserSettings.editor?.theme,
  );
  replaceAppSettings(activeUserSettings, { persist: true });
}

export function updateUserSettings(values: unknown): void {
  dbg("persistentUserSettings.mjs: Updating settings with:", values);
  updateAppSettings(values);
}

export function getUserSettings(section?: keyof AppSettings) {
  if (section && activeUserSettings[section]) {
    return activeUserSettings[section];
  }
  return activeUserSettings;
}

export function resetUserSettings(section?: keyof AppSettings): void {
  const defaults = createDefaultUserSettings();

  if (section && defaults[section]) {
    replaceUserSettings(
      mergeUserSettings(activeUserSettings, {
        [section]: defaults[section],
      }),
      { persist: true, dispatch: true },
    );
    return;
  }

  replaceUserSettings(defaults, { persist: true, dispatch: true });
}

export function deleteLocalStorage() {
  clearPersistedUserSettings();
  dbg("Local storage cleared.");
}
