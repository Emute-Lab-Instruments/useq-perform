/**
 * Configuration Loader
 *
 * Loads configuration at app startup with the following precedence:
 * 1. URL parameter overrides (?config=...)
 * 2. localStorage (user's local settings)
 * 3. default-config.json (committed defaults)
 * 4. Hardcoded defaults (fallback)
 */

// @ts-ignore - JSON import with assertion
import defaultConfig from './default-config.json' assert { type: 'json' };
import { validateConfiguration } from './configSchema.ts';
import { dbg } from '../utils.ts';
import {
  defaultUserSettings,
  mergeUserSettings,
  readPersistedUserSettings,
} from '../utils/persistentUserSettings.ts';
import type { RuntimeSettingsSource } from '../../runtime/runtimeDiagnostics.ts';

const GIST_NOT_FOUND_MESSAGE = 'gist not found';
const TEXT_NOT_FOUND_MESSAGE = 'code not found';

function isLocalStorageBypassed() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.has('nosave');
}

function parseGistId(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const maybeUrl = new URL(rawValue);
    const segments = maybeUrl.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || rawValue;
  } catch (_) {
    return rawValue;
  }
}

async function loadCodeOverrideFromURL() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has('gist')) {
    const gistId = parseGistId(urlParams.get('gist'));
    if (!gistId) {
      return GIST_NOT_FOUND_MESSAGE;
    }

    try {
      const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const files = Object.values(data?.files || {});
      const file = files.find((entry) => typeof entry?.content === 'string');
      return typeof file?.content === 'string' ? file.content : GIST_NOT_FOUND_MESSAGE;
    } catch (error) {
      console.error('configLoader: Failed to load gist from URL:', error);
      return GIST_NOT_FOUND_MESSAGE;
    }
  }

  if (urlParams.has('txt')) {
    const textUrl = urlParams.get('txt');
    if (!textUrl) {
      return TEXT_NOT_FOUND_MESSAGE;
    }

    try {
      const response = await fetch(textUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      console.error('configLoader: Failed to load text from URL:', error);
      return TEXT_NOT_FOUND_MESSAGE;
    }
  }

  return null;
}

/**
 * Load configuration from default-config.json
 * @returns {Object} Configuration from default file
 */
export function loadDefaultConfiguration() {
  try {
    dbg('configLoader: Loading default configuration');
    return defaultConfig.user || {};
  } catch (error) {
    console.error('configLoader: Failed to load default config:', error);
    return {};
  }
}

/**
 * Load configuration from localStorage
 * @returns {Object|null} Configuration from localStorage or null
 */
export function loadLocalStorageConfiguration() {
  try {
    if (isLocalStorageBypassed()) {
      return null;
    }

    const settings = readPersistedUserSettings();
    if (!settings) {
      return null;
    }

    dbg('configLoader: Loaded configuration from localStorage');
    return settings;
  } catch (error) {
    console.error('configLoader: Failed to load from localStorage:', error);
    return null;
  }
}

/**
 * Load configuration from URL parameter
 * @returns {Promise<Object|null>} Configuration from URL or null
 */
export async function loadURLConfiguration() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const configUrl = urlParams.get('config');

    if (!configUrl) {
      return null;
    }

    dbg('configLoader: Loading configuration from URL:', configUrl);

    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const config = await response.json();

    // Validate
    const validation = validateConfiguration(config);
    if (!validation.valid) {
      throw new Error(`Invalid config from URL: ${validation.errors.join(', ')}`);
    }

    dbg('configLoader: Loaded configuration from URL successfully');
    return config.user || {};
  } catch (error) {
    console.error('configLoader: Failed to load from URL:', error);
    return null;
  }
}

/**
 * Load configuration with full precedence chain
 * @returns {Promise<Object>} Merged configuration
 */
export async function loadConfiguration() {
  const result = await loadConfigurationWithMetadata();
  return result.config;
}

export async function loadConfigurationWithMetadata() {
  dbg('configLoader: Starting configuration load');
  const settingsSources: RuntimeSettingsSource[] = ['defaults'];

  // 1. Start with hardcoded defaults so omitted nested fields stay intact.
  let config = mergeUserSettings(defaultUserSettings, {});

  // 2. Merge committed defaults from default-config.json.
  config = mergeUserSettings(config, loadDefaultConfiguration());

  // 3. Merge with localStorage (user's persistent settings)
  const localConfig = loadLocalStorageConfiguration();
  if (localConfig) {
    config = mergeUserSettings(config, localConfig);
    settingsSources.push('local-storage');
    dbg('configLoader: Merged localStorage configuration');
  }

  // 4. Apply URL parameter overrides (highest priority)
  const urlConfig = await loadURLConfiguration();
  if (urlConfig) {
    config = mergeUserSettings(config, urlConfig);
    settingsSources.push('url-config');
    dbg('configLoader: Merged URL configuration');
  }

  // 5. Apply retained URL code sources after config precedence is resolved.
  const urlCode = await loadCodeOverrideFromURL();
  if (typeof urlCode === 'string') {
    config = mergeUserSettings(config, {
      editor: { code: urlCode },
    });
    settingsSources.push('url-code');
    dbg('configLoader: Merged URL code override');
  }

  // 6. ?nosave disables local persistence regardless of lower-precedence sources.
  if (isLocalStorageBypassed()) {
    config = mergeUserSettings(config, {
      storage: { saveCodeLocally: false },
    });
    settingsSources.push('nosave');
  }

  dbg('configLoader: Final configuration loaded');
  return { config, settingsSources };
}

/**
 * Load DevMode configuration if available
 * @returns {Object|null} DevMode configuration or null
 */
export function loadDevModeConfiguration() {
  if (!window.location.search.includes('devmode=true')) {
    return null;
  }

  try {
    const devModeStr = window.localStorage.getItem('uSEQ-Perform-DevMode-State');
    if (!devModeStr) {
      return null;
    }

    const devModeConfig = JSON.parse(devModeStr);
    dbg('configLoader: Loaded DevMode configuration');
    return devModeConfig;
  } catch (error) {
    console.error('configLoader: Failed to load DevMode config:', error);
    return null;
  }
}

/**
 * Save DevMode configuration to localStorage
 * @param {Object} devModeConfig DevMode configuration to save
 */
export function saveDevModeConfiguration(devModeConfig) {
  try {
    window.localStorage.setItem(
      'uSEQ-Perform-DevMode-State',
      JSON.stringify(devModeConfig)
    );
    dbg('configLoader: Saved DevMode configuration');
  } catch (error) {
    console.error('configLoader: Failed to save DevMode config:', error);
  }
}
