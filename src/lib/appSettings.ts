/**
 * Sanctioned public barrel for the settings layer.
 *
 * This is the canonical import surface for settings across the app (~30
 * importers). It aggregates the internal split:
 *   - `./settings/schema.ts`        — types, defaults, constants
 *   - `./settings/normalization.ts` — normalize, merge, config documents
 *   - `./settings/persistence.ts`   — read/write/clear persisted settings
 *
 * Import from here, not from the sub-modules — the split is an internal
 * organisation detail, not a public API.
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
  HardwareSettings,
  EvalResultMode,
  ConsoleEntryAnimation,
  ConsoleSettings,
  EvalResultsSettings,
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
  validateConfiguration,
  getConfigurationDiff,
} from "./settings/normalization.ts";

// Persistence: read/write/clear, bypass detection, bootstrap
export {
  isLocalStorageBypassed,
  readPersistedUserSettings,
  writePersistedUserSettings,
  clearPersistedUserSettings,
  loadBootstrapSettings,
} from "./settings/persistence.ts";
