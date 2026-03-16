/**
 * Configuration Manager
 *
 * Handles import, export, and persistence of configuration.
 * Provides hybrid saving strategy: WebSocket > File System API > Download
 */

import {
  validateConfiguration,
  getConfigurationDiff
} from './configSchema.ts';
import { getAppSettings, updateAppSettings } from '../../runtime/appSettingsRepository.ts';
import { getAllControlValues } from '../io/mockControlInputs.ts';
import { dbg } from '../utils.ts';
import {
  createConfigurationDocument,
  createDefaultUserSettings,
  mergeUserSettings,
  settingsPatchFromConfiguration,
} from './appSettings.ts';

const CONFIG_WS_URL = 'ws://localhost:8081';
const CONFIG_DEFAULT_PATH = 'src/legacy/config/default-config.json';

let configWebSocket = null;
let connectionAttempted = false;

/**
 * Export current configuration to JSON
 * @param {Object} options - Export options
 * @param {boolean} options.includeCode - Include editor code in export
 * @param {boolean} options.includeDevMode - Include devMode settings
 * @returns {Object} Configuration object
 */
export function exportConfiguration(options = {}) {
  const includeCode = options.includeCode ?? false;
  const includeDevMode = options.includeDevMode ?? true;

  dbg('configManager: Exporting configuration', options);

  // Extract base configuration from active settings
  const config = createConfigurationDocument(getAppSettings(), {
    includeCode,
    includeDevMode,
    metadataSource: 'webapp-export',
  });

  // Optionally include devMode settings
  if (includeDevMode) {
    try {
      config.devMode = {
        ...config.devMode,
        mockControls: getAllControlValues()
      };
    } catch (error) {
      dbg('configManager: Failed to get mock control values:', error);
    }
  }

  return config;
}

/**
 * Import configuration and apply to active settings
 * @param {Object} config - Configuration to import
 * @param {Object} options - Import options
 * @param {boolean} options.merge - Merge with existing settings (vs replace)
 * @returns {Object} Applied configuration
 */
export function importConfiguration(config, options = {}) {
  const merge = options.merge ?? true;

  dbg('configManager: Importing configuration', { merge });

  // Validate configuration
  const validation = validateConfiguration(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
  }

  // Apply configuration
  const importedSettings = settingsPatchFromConfiguration(config);
  let newSettings;
  if (merge) {
    newSettings = mergeUserSettings(getAppSettings(), importedSettings);
  } else {
    newSettings = mergeUserSettings(createDefaultUserSettings(), importedSettings);
  }

  // Update active settings
  updateAppSettings(newSettings);

  dbg('configManager: Configuration imported successfully');

  return newSettings;
}

/**
 * Connect to Node.js config server (if available)
 * @returns {Promise<WebSocket|null>} WebSocket connection or null
 */
export async function connectToConfigServer() {
  if (configWebSocket && configWebSocket.readyState === WebSocket.OPEN) {
    return configWebSocket;
  }

  if (connectionAttempted) {
    return null;
  }

  connectionAttempted = true;

  return new Promise((resolve) => {
    try {
      dbg('configManager: Connecting to config server at', CONFIG_WS_URL);

      const ws = new WebSocket(CONFIG_WS_URL);

      ws.onopen = () => {
        dbg('configManager: Connected to config server');
        configWebSocket = ws;
        resolve(ws);
      };

      ws.onerror = (error) => {
        dbg('configManager: Config server not available:', error);
        configWebSocket = null;
        resolve(null);
      };

      ws.onclose = () => {
        dbg('configManager: Config server connection closed');
        configWebSocket = null;
      };

      // Timeout after 2 seconds
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          dbg('configManager: Config server connection timeout');
          ws.close();
          configWebSocket = null;
          resolve(null);
        }
      }, 2000);

    } catch (error) {
      dbg('configManager: Failed to connect to config server:', error);
      resolve(null);
    }
  });
}

/**
 * Check if config server is available
 * @returns {boolean} True if connected
 */
export function isConfigServerAvailable() {
  return configWebSocket !== null && configWebSocket.readyState === WebSocket.OPEN;
}

/**
 * Save configuration via WebSocket to filesystem
 * @param {Object} config - Configuration to save
 * @param {string} relativePath - Path relative to project root
 * @returns {Promise<Object>} Result object
 */
export async function saveConfigurationViaWebSocket(config, relativePath = CONFIG_DEFAULT_PATH) {
  if (!isConfigServerAvailable()) {
    const ws = await connectToConfigServer();
    if (!ws) {
      return { success: false, method: 'websocket', error: 'Config server unavailable' };
    }
  }

  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    dbg('configManager: Saving config via WebSocket to', relativePath);

    const handler = (event) => {
      try {
        const response = JSON.parse(event.data);
        if (response.requestId === requestId) {
          configWebSocket.removeEventListener('message', handler);

          if (response.type === 'save-config-success') {
            dbg('configManager: Config saved successfully via WebSocket');
            resolve({
              success: true,
              method: 'websocket',
              path: response.path,
              absolutePath: response.absolutePath
            });
          } else {
            dbg('configManager: Config save failed via WebSocket:', response.error);
            resolve({
              success: false,
              method: 'websocket',
              error: response.error
            });
          }
        }
      } catch (error) {
        dbg('configManager: Error parsing WebSocket response:', error);
      }
    };

    configWebSocket.addEventListener('message', handler);

    configWebSocket.send(JSON.stringify({
      type: 'save-config',
      requestId,
      path: relativePath,
      data: config
    }));

    // Timeout after 5 seconds
    setTimeout(() => {
      configWebSocket.removeEventListener('message', handler);
      resolve({
        success: false,
        method: 'websocket',
        error: 'Request timeout'
      });
    }, 5000);
  });
}

/**
 * Save configuration via File System Access API
 * @param {Object} config - Configuration to save
 * @returns {Promise<Object>} Result object
 */
async function saveConfigurationViaFileSystemAPI(config) {
  if (!window.showSaveFilePicker) {
    return { success: false, method: 'filesystem-api', error: 'API not supported' };
  }

  try {
    dbg('configManager: Opening file picker...');

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: 'useq-config.json',
      types: [{
        description: 'uSEQ Configuration',
        accept: { 'application/json': ['.json'] }
      }]
    });

    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(config, null, 2));
    await writable.close();

    dbg('configManager: Config saved via File System API');

    return {
      success: true,
      method: 'filesystem-api',
      name: fileHandle.name
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      dbg('configManager: File picker cancelled by user');
      return { success: false, method: 'filesystem-api', error: 'cancelled' };
    }
    dbg('configManager: File System API error:', error);
    return { success: false, method: 'filesystem-api', error: error.message };
  }
}

/**
 * Download configuration as a file
 * @param {Object} config - Configuration to download
 */
function downloadConfiguration(config) {
  dbg('configManager: Downloading configuration file');

  const jsonString = JSON.stringify(config, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `useq-config-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);

  dbg('configManager: Configuration downloaded');
}

/**
 * Save configuration using hybrid strategy
 * Tries: WebSocket → File System API → Download
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Result object with method and success status
 */
export async function saveConfiguration(options = {}) {
  const config = exportConfiguration(options);

  dbg('configManager: Saving configuration with hybrid strategy');

  // Method 1: Try WebSocket first (if available)
  const wsResult = await saveConfigurationViaWebSocket(config);
  if (wsResult.success) {
    return wsResult;
  }

  dbg('configManager: WebSocket save failed, trying File System API');

  // Method 2: Try File System Access API
  const fsResult = await saveConfigurationViaFileSystemAPI(config);
  if (fsResult.success) {
    return fsResult;
  }

  dbg('configManager: File System API failed, falling back to download');

  // Method 3: Fallback to download
  downloadConfiguration(config);
  return {
    success: true,
    method: 'download',
    message: 'Configuration downloaded'
  };
}

/**
 * Load configuration from file (user selects file)
 * @returns {Promise<Object>} Loaded configuration
 */
export async function loadConfigurationFromFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) {
          reject(new Error('No file selected'));
          return;
        }

        const text = await file.text();
        const config = JSON.parse(text);

        // Validate
        const validation = validateConfiguration(config);
        if (!validation.valid) {
          reject(new Error(`Invalid configuration: ${validation.errors.join(', ')}`));
          return;
        }

        dbg('configManager: Configuration loaded from file:', file.name);
        resolve(config);
      } catch (error) {
        dbg('configManager: Error loading configuration file:', error);
        reject(error);
      }
    };

    input.click();
  });
}

/**
 * Get a preview of what would change if a config were applied
 * @param {Object} config - Configuration to preview
 * @returns {Object} Preview information
 */
export function previewConfiguration(config) {
  const diffs = getConfigurationDiff(
    { user: getAppSettings() },
    config
  );

  return {
    diffs,
    hasChanges: diffs.length > 0,
    config
  };
}
