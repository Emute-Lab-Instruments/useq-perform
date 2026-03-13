import defaultConfig from "../legacy/config/default-config.json";
import { validateConfiguration } from "../legacy/config/configSchema.ts";
import {
  createDefaultUserSettings,
  defaultUserSettings,
  loadBootstrapSettings,
  mergeUserSettings,
  normalizeUserSettings,
  readPersistedUserSettings,
  settingsPatchFromConfiguration,
  writePersistedUserSettings,
  type AppSettings,
} from "../legacy/config/appSettings.ts";
import { defaultMainEditorStartingCode } from "../legacy/editors/defaults.ts";
import {
  publishRuntimeDiagnostics,
  type RuntimeSettingsSource,
} from "./runtimeDiagnostics.ts";
import { updateRuntimeSessionState } from "./runtimeSessionStore.ts";
import {
  getStartupFlagsSnapshot,
  setStartupFlags,
  type StartupFlags,
} from "./startupContext.ts";
import { readStartupFlags } from "../legacy/urlParams.ts";

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

function notifyListeners(): void {
  const snapshot = getAppSettings();
  listeners.forEach((listener) => listener(snapshot));
}

function dispatchSettingsChanged(): void {
  const runtimeState = updateRuntimeSessionState({
    wasmEnabled: activeSettings.wasm.enabled,
  });
  publishRuntimeDiagnostics({
    runtimeSession: runtimeState.session,
  });

  try {
    window.dispatchEvent(
      new CustomEvent("useq-settings-changed", { detail: getAppSettings() }),
    );
  } catch {
    // no-op in non-browser tests
  }
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

function resolveRepositoryStartupFlags(): StartupFlags {
  const startupFlags = getStartupFlagsSnapshot();
  if (Object.keys(startupFlags.params).length > 0 || typeof window === "undefined") {
    return startupFlags;
  }

  return setStartupFlags(readStartupFlags(window.location.search));
}

async function loadCodeOverrideFromStartupFlags(): Promise<string | null> {
  const startupFlags = resolveRepositoryStartupFlags();

  if (startupFlags.params.default !== undefined) {
    return defaultMainEditorStartingCode;
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
    dispatch?: boolean;
  } = {},
): AppSettings {
  activeSettings = normalizeUserSettings(values);

  if (options.persist) {
    writePersistedUserSettings(activeSettings, {
      bypassLocalStorage: resolveRepositoryStartupFlags().nosave,
    });
  }

  if (options.dispatch) {
    dispatchSettingsChanged();
  }

  notifyListeners();
  return getAppSettings();
}

export function loadAppSettings(): AppSettings {
  const persistedSettings = readPersistedUserSettings({
    bypassLocalStorage: resolveRepositoryStartupFlags().nosave,
  });
  return replaceAppSettings(
    persistedSettings ?? createDefaultUserSettings(),
    { dispatch: false },
  );
}

export function updateAppSettings(values: unknown): AppSettings {
  return replaceAppSettings(mergeUserSettings(activeSettings, values), {
    persist: true,
    dispatch: true,
  });
}

export const appSettingsRepository = {
  getSettings: getAppSettings,
  subscribe: subscribeAppSettings,
  replaceSettings: replaceAppSettings,
  loadSettings: loadAppSettings,
  updateSettings: updateAppSettings,
  loadBootstrapSettingsWithMetadata,
};
