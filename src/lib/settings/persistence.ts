/**
 * Settings Persistence
 *
 * Reading, writing, and clearing persisted user settings.
 * Delegates to the centralised persistence service and handles legacy migration.
 */

import { defaultTheme } from "../editorDefaults.ts";
import { themes } from "../../editors/themes.ts";
import { isLocalStorageBypassedInStartupContext } from "../../runtime/startupContext.ts";
import { load, loadRaw, save, saveRaw, remove, has, PERSISTENCE_KEYS } from "../persistence.ts";
import type { AppSettings, AppSettingsPatch } from "./schema.ts";
import { createDefaultUserSettings } from "./schema.ts";
import {
  createStoredSettingsSnapshot,
  mergeUserSettings,
  normalizeUserSettings,
} from "./normalization.ts";
import type { RuntimeSettingsSource } from "../../runtime/runtimeDiagnostics.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isLocalStorageBypassed(options: {
  search?: string;
  bypassLocalStorage?: boolean;
} = {}): boolean {
  if (typeof options.bypassLocalStorage === "boolean") {
    return options.bypassLocalStorage;
  }

  if (typeof window === "undefined") {
    return isLocalStorageBypassedInStartupContext();
  }

  const search = options.search ?? window.location.search;

  try {
    return new URLSearchParams(search).has("nosave");
  } catch {
    return false;
  }
}

function shouldBypassLocalStorage(options: {
  bypassLocalStorage?: boolean;
  search?: string;
} = {}): boolean {
  if (typeof options.bypassLocalStorage === "boolean") {
    return options.bypassLocalStorage;
  }

  if (typeof window === "undefined") {
    return isLocalStorageBypassedInStartupContext();
  }

  return isLocalStorageBypassed(options);
}

function decodeStoredCode(code: unknown): string | null {
  if (typeof code !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(code);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Keep plain-text code as the canonical format.
  }

  return code;
}

function hasLegacySettings(): boolean {
  return (
    has(PERSISTENCE_KEYS.legacyEditorConfig) ||
    has(PERSISTENCE_KEYS.legacySettings) ||
    has(PERSISTENCE_KEYS.legacyCode)
  );
}

function migrateLegacySettings(): AppSettingsPatch {
  const migrated: AppSettingsPatch = {};
  const editorConfig = load<Record<string, unknown>>(PERSISTENCE_KEYS.legacyEditorConfig);

  if (editorConfig) {
    try {
      const themeNames = Object.keys(themes);
      const themeIndex = Number(editorConfig.currentTheme) % themeNames.length;
      migrated.editor = {
        ...editorConfig,
        theme: themeNames[themeIndex] || defaultTheme,
      };
      delete (migrated.editor as Record<string, unknown>).currentTheme;
    } catch { /* corrupt legacy data, skip migration */ }
    remove(PERSISTENCE_KEYS.legacyEditorConfig);
  }

  const generalConfig = load<Record<string, unknown>>(PERSISTENCE_KEYS.legacySettings);
  if (generalConfig) {
    try {
      if (isRecord(generalConfig.storage)) {
        const legacyStorage = generalConfig.storage as Record<string, unknown>;
        migrated.storage = {
          ...legacyStorage,
          saveCodeLocally:
            legacyStorage.savelocal == null
              ? undefined
              : legacyStorage.savelocal !== false,
        };
        delete (migrated.storage as Record<string, unknown>).savelocal;
      }

      if (isRecord(generalConfig.ui)) {
        migrated.ui = { ...generalConfig.ui };
      }
    } catch { /* corrupt legacy data, skip migration */ }
    remove(PERSISTENCE_KEYS.legacySettings);
  }

  const legacyCodeValue =
    loadRaw(PERSISTENCE_KEYS.legacyCode) ?? loadRaw(PERSISTENCE_KEYS.editorCode);
  const decodedCode = decodeStoredCode(legacyCodeValue);
  if (decodedCode !== null) {
    migrated.editor = {
      ...(migrated.editor || {}),
      code: decodedCode,
    };
    remove(PERSISTENCE_KEYS.legacyCode);
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readPersistedUserSettings(options: {
  bypassLocalStorage?: boolean;
} = {}): AppSettings | null {
  if (typeof window === "undefined" || shouldBypassLocalStorage(options)) {
    return null;
  }

  const storedSettings = load<Record<string, unknown>>(PERSISTENCE_KEYS.settings);
  const legacySettingsPresent = hasLegacySettings();
  const storedCodeValue = loadRaw(PERSISTENCE_KEYS.editorCode);

  if (!storedSettings && storedCodeValue == null && !legacySettingsPresent) {
    return null;
  }

  let loaded: AppSettingsPatch = {};

  if (storedSettings) {
    loaded = isRecord(storedSettings) ? (storedSettings as Partial<AppSettings>) : {};
  } else if (legacySettingsPresent) {
    loaded = migrateLegacySettings();
  }

  const legacyCodeValue =
    !storedSettings && legacySettingsPresent
      ? loadRaw(PERSISTENCE_KEYS.legacyCode)
      : null;
  const decodedCode = decodeStoredCode(storedCodeValue ?? legacyCodeValue);
  if (decodedCode !== null) {
    loaded = {
      ...loaded,
      editor: {
        ...(loaded.editor ?? {}),
        code: decodedCode,
      },
    };
  }

  const normalized = normalizeUserSettings(loaded);
  writePersistedUserSettings(normalized);
  return normalized;
}

export function writePersistedUserSettings(settings: unknown, options: {
  bypassLocalStorage?: boolean;
} = {}): void {
  if (typeof window === "undefined" || shouldBypassLocalStorage(options)) {
    return;
  }

  const normalized = normalizeUserSettings(settings);
  const storedSettings = createStoredSettingsSnapshot(normalized);

  save(PERSISTENCE_KEYS.settings, storedSettings);
  saveRaw(PERSISTENCE_KEYS.editorCode, normalized.editor.code);
}

export function clearPersistedUserSettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  remove(PERSISTENCE_KEYS.settings);
  remove(PERSISTENCE_KEYS.editorCode);
  remove(PERSISTENCE_KEYS.legacyEditorConfig);
  remove(PERSISTENCE_KEYS.legacySettings);
  remove(PERSISTENCE_KEYS.legacyCode);
}

export async function loadBootstrapSettings(options: {
  defaultSettings?: unknown;
  loadUrlConfig?: () => Promise<unknown>;
  loadUrlCode?: () => Promise<string | null>;
  bypassLocalStorage?: boolean;
} = {}): Promise<{
  config: AppSettings;
  settingsSources: RuntimeSettingsSource[];
}> {
  const settingsSources: RuntimeSettingsSource[] = ["defaults"];
  let config = normalizeUserSettings(
    options.defaultSettings ?? createDefaultUserSettings(),
  );

  const persisted = readPersistedUserSettings({
    bypassLocalStorage: options.bypassLocalStorage,
  });
  if (persisted) {
    config = mergeUserSettings(config, persisted);
    settingsSources.push("local-storage");
  }

  if (options.loadUrlConfig) {
    const urlConfig = await options.loadUrlConfig();
    if (urlConfig) {
      config = mergeUserSettings(config, urlConfig);
      settingsSources.push("url-config");
    }
  }

  if (options.loadUrlCode) {
    const urlCode = await options.loadUrlCode();
    if (typeof urlCode === "string") {
      config = mergeUserSettings(config, {
        editor: { code: urlCode },
      });
      settingsSources.push("url-code");
    }
  }

  if (shouldBypassLocalStorage({ bypassLocalStorage: options.bypassLocalStorage })) {
    config = mergeUserSettings(config, {
      storage: { saveCodeLocally: false },
    });
    settingsSources.push("nosave");
  }

  return { config, settingsSources };
}
