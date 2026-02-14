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
import { mergeConfigurations, validateConfiguration } from './configSchema.ts';
import { dbg } from '../utils.ts';

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
    const settingsStr = window.localStorage.getItem('uSEQ-Perform-User-Settings');
    if (!settingsStr) {
      return null;
    }

    const settings = JSON.parse(settingsStr);
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
  dbg('configLoader: Starting configuration load');

  // 1. Start with default-config.json (compiled defaults)
  let config = loadDefaultConfiguration();

  // 2. Merge with localStorage (user's persistent settings)
  const localConfig = loadLocalStorageConfiguration();
  if (localConfig) {
    config = mergeConfigurations(config, localConfig);
    dbg('configLoader: Merged localStorage configuration');
  }

  // 3. Apply URL parameter overrides (highest priority)
  const urlConfig = await loadURLConfiguration();
  if (urlConfig) {
    config = mergeConfigurations(config, urlConfig);
    dbg('configLoader: Merged URL configuration');
  }

  dbg('configLoader: Final configuration loaded');
  return config;
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
