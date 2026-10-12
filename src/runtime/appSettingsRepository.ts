import defaultConfig from "./default-config.json" with { type: "json" };
import {
  createDefaultUserSettings,
  defaultUserSettings,
  loadBootstrapSettings,
  mergeUserSettings,
  normalizeUserSettings,
  readPersistedUserSettings,
  settingsPatchFromConfiguration,
  validateConfiguration,
  writePersistedUserSettings,
  type AppSettings,
} from "../lib/appSettings.ts";
import { defaultMainEditorStartingCode } from "../lib/editorDefaults.ts";
import type { RuntimeSettingsSource } from "./runtimeDiagnostics.ts";
import {
  getStartupFlagsSnapshot,
  type StartupFlags,
} from "./startupContext.ts";
import { readStartupFlags } from "./startupContext.ts";

const GIST_NOT_FOUND_MESSAGE = "gist not found";
const TEXT_NOT_FOUND_MESSAGE = "code not found";

type SettingsListener = (settings: AppSettings) => void;
type GistFile = {
  content?: string;
};

let activeSettings = normalizeUserSettings(createDefaultUserSettings());
const listeners = new Set<SettingsListener>();

function cloneSettings(settings: AppSettings): AppSettings {
  return normalizeUserSettings(settings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function changedSettingsPatch(current: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return {};
  const base = isRecord(current) ? current : {};
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const prior = base[key];
    if (isRecord(value) && isRecord(prior)) {
      const nested = changedSettingsPatch(prior, value) as Record<string, unknown>;
      if (Object.keys(nested).length > 0) changed[key] = nested;
    } else if (JSON.stringify(value) !== JSON.stringify(prior)) {
      changed[key] = value;
    }
  }
  return changed;
}

function notifyListeners(): void {
  const snapshot = getAppSettings();
  listeners.forEach((listener) => listener(snapshot));
}

function parseGistId(rawValue: string | null | undefined): string | null {
  if (!rawValue) {
    return null;
  }

  try {
    const maybeUrl = new URL(rawValue);
    const segments = maybeUrl.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || rawValue;
  } catch {
    return rawValue;
  }
}

/**
 * Read-only resolution of startup flags for repository queries.
 * After bootstrap, startupContext is frozen so we just read the snapshot.
 * The fallback to readStartupFlags(window.location.search) handles the
 * edge case where this is called before examineEnvironment() has run
 * (e.g. during early settings load) — but it never mutates the context.
 */
function resolveRepositoryStartupFlags(): StartupFlags {
  const startupFlags = getStartupFlagsSnapshot();
  if (Object.keys(startupFlags.params).length > 0 || typeof window === "undefined") {
    return startupFlags;
  }

  return readStartupFlags(window.location.search);
}

async function loadCodeOverrideFromStartupFlags(): Promise<string | null> {
  const startupFlags = resolveRepositoryStartupFlags();

  if (startupFlags.params.default !== undefined) {
    return defaultMainEditorStartingCode;
  }

  // Spec (url-params.md §1.3): if both ?txt and ?gist are specified,
  // ?txt wins. ?gist is ignored.
  if (startupFlags.params.txt) {
    try {
      const response = await fetch(startupFlags.params.txt);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      console.error("appSettingsRepository: Failed to load text from URL:", error);
      return TEXT_NOT_FOUND_MESSAGE;
    }
  }

  if (startupFlags.params.gist) {
    const gistId = parseGistId(startupFlags.params.gist);
    if (!gistId) {
      return GIST_NOT_FOUND_MESSAGE;
    }

    try {
      const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
        headers: {
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const files = Object.values(data?.files || {}) as GistFile[];
      const file = files.find((entry) => typeof entry?.content === "string");
      return typeof file?.content === "string" ? file.content : GIST_NOT_FOUND_MESSAGE;
    } catch (error) {
      console.error("appSettingsRepository: Failed to load gist from URL:", error);
      return GIST_NOT_FOUND_MESSAGE;
    }
  }

  return null;
}

export function loadDefaultConfiguration(): unknown {
  try {
    return settingsPatchFromConfiguration(defaultConfig);
  } catch (error) {
    console.error("appSettingsRepository: Failed to load default config:", error);
    return {};
  }
}

export function loadLocalStorageConfiguration(): AppSettings | null {
  try {
    return readPersistedUserSettings({
      bypassLocalStorage: resolveRepositoryStartupFlags().nosave,
    });
  } catch (error) {
    console.error("appSettingsRepository: Failed to load local settings:", error);
    return null;
  }
}

export async function loadURLConfiguration(): Promise<unknown | null> {
  const configUrl = resolveRepositoryStartupFlags().params.config;

  if (!configUrl) {
    return null;
  }

  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const config = await response.json();
    const validation = validateConfiguration(config);
    if (!validation.valid) {
      throw new Error(`Invalid config from URL: ${validation.errors.join(", ")}`);
    }

    return settingsPatchFromConfiguration(config);
  } catch (error) {
    console.error("appSettingsRepository: Failed to load config from URL:", error);
    return null;
  }
}

export async function loadBootstrapSettingsWithMetadata(): Promise<{
  config: AppSettings;
  settingsSources: RuntimeSettingsSource[];
}> {
  const committedDefaults = mergeUserSettings(
    defaultUserSettings,
    loadDefaultConfiguration(),
  );

  return loadBootstrapSettings({
    defaultSettings: committedDefaults,
    loadUrlConfig: loadURLConfiguration,
    loadUrlCode: loadCodeOverrideFromStartupFlags,
    bypassLocalStorage: resolveRepositoryStartupFlags().nosave,
  });
}

export function getAppSettings(): AppSettings {
  return cloneSettings(activeSettings);
}

export function subscribeAppSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function replaceAppSettings(
  values: unknown,
  options: {
    persist?: boolean;
  } = {},
): AppSettings {
  activeSettings = normalizeUserSettings(values);

  if (options.persist) {
    writePersistedUserSettings(activeSettings, {
      bypassLocalStorage: resolveRepositoryStartupFlags().nosave,
    });
  }

  notifyListeners();
  return getAppSettings();
}

export function updateAppSettings(
  values: unknown,
  options: { persist?: boolean } = {},
): AppSettings {
  const persistencePatch = changedSettingsPatch(activeSettings, values);
  const nextSettings = mergeUserSettings(activeSettings, values);
  if (
    (options.persist ?? true) &&
    Object.keys(persistencePatch as Record<string, unknown>).length > 0
  ) {
    // Persist the explicit patch over the stored baseline. URL configuration
    // is active for this session, but must not leak into unrelated saved keys.
    const persisted = readPersistedUserSettings({
      bypassLocalStorage: resolveRepositoryStartupFlags().nosave,
    });
    writePersistedUserSettings(
      mergeUserSettings(persisted ?? createDefaultUserSettings(), persistencePatch),
      { bypassLocalStorage: resolveRepositoryStartupFlags().nosave },
    );
  }
  return replaceAppSettings(nextSettings);
}

export function resetAppSettings(section?: keyof AppSettings): AppSettings {
  const defaults = createDefaultUserSettings();

  if (section && defaults[section]) {
    return replaceAppSettings(
      mergeUserSettings(activeSettings, {
        [section]: defaults[section],
      }),
      { persist: true },
    );
  }

  return replaceAppSettings(defaults, { persist: true });
}
