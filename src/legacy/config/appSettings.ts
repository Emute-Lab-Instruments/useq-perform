/**
 * Re-export from canonical location.
 * Legacy code should migrate to import from src/lib/appSettings.ts directly.
 */
export {
  CONFIG_VERSION,
  settingsStorageKey,
  codeStorageKey,
  defaultUserSettings,
  defaultDevModeConfiguration,
  createDefaultUserSettings,
  normalizeUserSettings,
  mergeUserSettings,
  createStoredSettingsSnapshot,
  createConfigurationDocument,
  settingsPatchFromConfiguration,
  isLocalStorageBypassed,
  readPersistedUserSettings,
  writePersistedUserSettings,
  clearPersistedUserSettings,
  loadBootstrapSettings,
} from "../../lib/appSettings.ts";
export type {
  EditorSettings,
  StorageSettings,
  UISettings,
  VisualisationSettings,
  RuntimeSettings,
  WasmSettings,
  AppSettings,
  StoredAppSettings,
  ConfigDocumentMetadata,
  AppConfigDocument,
  AppDevModeState,
} from "../../lib/appSettings.ts";
