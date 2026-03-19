/**
 * Barrel re-export for settings modules.
 *
 * All existing importers can continue to use `../lib/appSettings.ts`.
 * New code should prefer importing from the specific sub-module:
 *   - `../lib/settings/schema.ts`       — types, defaults, constants
 *   - `../lib/settings/normalization.ts` — normalize, merge, config documents
 *   - `../lib/settings/persistence.ts`   — read/write/clear persisted settings
 */

// Schema: types, defaults, constants
export {
  CONFIG_VERSION,
  settingsStorageKey,
  codeStorageKey,
  defaultDevModeConfiguration,
  defaultUserSettings,
  createDefaultUserSettings,
} from "./settings/schema.ts";

export type {
  EditorSettings,
  StorageSettings,
  UISettings,
  VisualisationSettings,
  RuntimeSettings,
  WasmSettings,
  AppSettings,
  AppSettingsPatch,
  StoredAppSettings,
  ConfigDocumentMetadata,
  AppConfigDocument,
  AppDevModeState,
} from "./settings/schema.ts";

// Normalization: validate, merge, config document helpers
export {
  normalizeUserSettings,
  mergeUserSettings,
  createStoredSettingsSnapshot,
  createConfigurationDocument,
  settingsPatchFromConfiguration,
} from "./settings/normalization.ts";

// Persistence: read/write/clear, bypass detection, bootstrap
export {
  isLocalStorageBypassed,
  readPersistedUserSettings,
  writePersistedUserSettings,
  clearPersistedUserSettings,
  loadBootstrapSettings,
} from "./settings/persistence.ts";
