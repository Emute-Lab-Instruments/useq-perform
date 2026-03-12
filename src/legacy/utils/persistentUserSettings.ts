/**
 * Configuration Manager Module
 * 
 * Handles application configuration, including loading, saving,
 * and providing defaults.
 */
import { defaultFontSize, defaultTheme, defaultMainEditorStartingCode } from "../editors/defaults.ts";
import { themes } from "../editors/themes/themeManager.ts";
import {dbg} from "../utils.ts";

dbg("persistentUserSettings.mjs: Loading with defaults:", { defaultTheme, defaultFontSize });


// Export both the new and old names for backward compatibility
dbg('persistentUserSettings.mjs: Importing with defaultTheme:', defaultTheme);
dbg('persistentUserSettings.mjs: Available themes:', Object.keys(themes));

export const settingsStorageKey = "uSEQ-Perform-User-Settings";
export const codeStorageKey = "uSEQ-Perform-User-Code";
const legacyCodeStorageKey = "useqcode";

// Default application configuration
export const defaultUserSettings = {
  name: "Livecoder",
  editor: {
    code: defaultMainEditorStartingCode,
    theme: defaultTheme,
    fontSize: defaultFontSize,
    preventBracketUnbalancing: true },
  storage : {  
    saveCodeLocally: true,
    autoSaveEnabled: true,
    autoSaveInterval: 5000, // ms
  },
  ui: {
    consoleLinesLimit: 1000,
    customThemes: [],
    // OS family for key display/bindings: 'pc' (Linux/Windows) or 'mac'
    osFamily: 'pc',
    // Editor UI features
    expressionGutterEnabled: true,
    expressionLastTrackingEnabled: true,
    expressionClearButtonEnabled: true,
    // Gamepad picker style: 'grid' (hierarchical grid) or 'radial'
    gamepadPickerStyle: 'grid'
  },
  visualisation: {
    offsetSeconds: 5,
    sampleCount: 100,
    lineWidth: 1.5,
    futureDashed: true,
    futureMaskOpacity: 0.35,
    futureMaskWidth: 12,
    circularOffset: 0,
    digitalLaneGap: 4
  },
  runtime: {
    autoReconnect: true,
    startLocallyWithoutHardware: true
  },
  wasm: {
    enabled: true
  }
};

dbg('persistentUserSettings.mjs: Default settings theme:', defaultUserSettings.editor.theme);

function cloneDefaultUserSettings() {
  return {
    ...defaultUserSettings,
    editor: { ...defaultUserSettings.editor },
    storage: { ...defaultUserSettings.storage },
    ui: { ...defaultUserSettings.ui },
    visualisation: { ...defaultUserSettings.visualisation },
    runtime: { ...defaultUserSettings.runtime },
    wasm: { ...defaultUserSettings.wasm },
  };
}

export function mergeUserSettings(base, values = {}) {
  return {
    ...base,
    ...values,
    editor: values.editor ? { ...base.editor, ...values.editor } : { ...base.editor },
    storage: values.storage ? { ...base.storage, ...values.storage } : { ...base.storage },
    ui: values.ui ? { ...base.ui, ...values.ui } : { ...base.ui },
    visualisation: values.visualisation
      ? { ...base.visualisation, ...values.visualisation }
      : { ...base.visualisation },
    runtime: values.runtime ? { ...base.runtime, ...values.runtime } : { ...base.runtime },
    wasm: values.wasm ? { ...base.wasm, ...values.wasm } : { ...base.wasm },
  };
}

function isLocalStorageBypassed() {
  if (typeof window === "undefined" || !window.location?.search) {
    return false;
  }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has("nosave");
  } catch (error) {
    dbg("persistentUserSettings.mjs: Failed to inspect URL params for nosave:", error);
    return false;
  }
}

function decodeStoredCode(code) {
  if (typeof code !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(code);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch (_) {
    // The canonical format is plain text; keep legacy JSON-string values compatible.
  }

  return code;
}

function detectOsFamily() {
  const platformStr =
    (typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent || "")) || "";
  return /Mac|iPhone|iPad|iPod/i.test(platformStr) ? "mac" : "pc";
}

function normalizeUserSettings(settings = {}) {
  let normalized = mergeUserSettings(cloneDefaultUserSettings(), settings);

  if (typeof normalized.editor?.code !== "string") {
    normalized = mergeUserSettings(normalized, {
      editor: { code: defaultMainEditorStartingCode },
    });
  }

  if (normalized.editor?.theme === "default") {
    dbg("persistentUserSettings.mjs: Converting legacy 'default' theme to:", defaultTheme);
    normalized.editor.theme = defaultTheme;
  }

  if (!themes[normalized.editor?.theme]) {
    dbg("persistentUserSettings.mjs: Theme not found in available themes, resetting to:", defaultTheme);
    normalized.editor.theme = defaultTheme;
  }

  if (!normalized.ui?.osFamily) {
    normalized.ui.osFamily = detectOsFamily();
  }

  return normalized;
}

function persistUserSettings(settings) {
  if (isLocalStorageBypassed()) {
    return;
  }

  try {
    const normalized = normalizeUserSettings(settings);
    const settingsWithoutCode = {
      ...normalized,
      editor: { ...normalized.editor },
    };
    const code = settingsWithoutCode.editor.code;
    delete settingsWithoutCode.editor.code;

    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settingsWithoutCode));
    window.localStorage.setItem(codeStorageKey, code);
  } catch (error) {
    console.error("Error saving configuration:", error);
  }
}

function hasLegacySettings() {
  return Boolean(
    window.localStorage.getItem("editorConfig") ||
      window.localStorage.getItem("useqConfig") ||
      window.localStorage.getItem(legacyCodeStorageKey)
  );
}

function dispatchSettingsChanged() {
  try {
    window.dispatchEvent(new CustomEvent("useq-settings-changed", { detail: activeUserSettings }));
  } catch (_) {}
}

export function replaceUserSettings(values, options = {}) {
  const { persist = false, dispatch = false } = options;
  activeUserSettings = normalizeUserSettings(values);

  if (persist) {
    persistUserSettings(activeUserSettings);
  }

  if (dispatch) {
    dispatchSettingsChanged();
  }

  return activeUserSettings;
}

export function readPersistedUserSettings() {
  if (typeof window === "undefined" || isLocalStorageBypassed()) {
    return null;
  }

  dbg("persistentUserSettings.mjs: Loading user settings...");

  try {
    const retrievedSettingsStr = window.localStorage.getItem(settingsStorageKey);
    const legacySettingsPresent = hasLegacySettings();
    const storedCodeValue =
      window.localStorage.getItem(codeStorageKey) ?? window.localStorage.getItem(legacyCodeStorageKey);

    if (!retrievedSettingsStr && !legacySettingsPresent && storedCodeValue == null) {
      return null;
    }

    let settings = cloneDefaultUserSettings();
    let migratedLegacySettings = false;

    if (retrievedSettingsStr) {
      const retrievedSettings = JSON.parse(retrievedSettingsStr);
      dbg("persistentUserSettings.mjs: Retrieved settings theme:", retrievedSettings.editor?.theme);
      settings = mergeUserSettings(settings, retrievedSettings);
    } else if (legacySettingsPresent) {
      dbg("persistentUserSettings.mjs: No settings found, checking legacy config...");
      settings = migrateLegacyConfig(settings);
      migratedLegacySettings = true;
    }

    const decodedCode = decodeStoredCode(storedCodeValue);
    if (decodedCode !== null) {
      settings = mergeUserSettings(settings, {
        editor: { code: decodedCode },
      });
    }

    const normalized = normalizeUserSettings(settings);

    if (migratedLegacySettings) {
      persistUserSettings(normalized);
    }

    return normalized;
  } catch (error) {
    console.error("Error loading user settings:", error);
    return null;
  }
}

// Active configuration (initialized with defaults)
export let activeUserSettings = normalizeUserSettings(cloneDefaultUserSettings());
dbg('persistentUserSettings.mjs: Initial active settings theme:', activeUserSettings.editor.theme);

/**
 * Load configuration from localStorage
 * @returns {Object} The merged configuration (defaults + saved values)
 */
export function loadUserSettings() {
  const persistedSettings = readPersistedUserSettings();
  return replaceUserSettings(persistedSettings ?? cloneDefaultUserSettings());
}

/**
 * Save current configuration to localStorage
 */
export function saveUserSettings() {
  dbg("persistentUserSettings.mjs: Saving settings with theme:", activeUserSettings.editor?.theme);
  persistUserSettings(activeUserSettings);
}

/**
 * Update a specific section of the configuration
 * @param {string} section - Configuration section to update (e.g., 'editor', 'storage', 'ui')
 * @param {Object} values - New values to merge
 */
export function updateUserSettings(values) {
  dbg("persistentUserSettings.mjs: Updating settings with:", values);
  replaceUserSettings(mergeUserSettings(activeUserSettings, values), {
    persist: true,
    dispatch: true,
  });
}

/**
 * Get the current active configuration
 * @param {string} [section] - Optional section to retrieve (retrieves full config if omitted)
 * @returns {Object} Current configuration or section
 */
export function getUserSettings(section) {
  if (section && activeUserSettings[section]) {
    return activeUserSettings[section];
  }
  return activeUserSettings;
}

/**
 * Reset configuration to defaults
 * @param {string} [section] - Optional section to reset (resets all if omitted)
 */
export function resetUserSettings(section) {
  if (section && defaultUserSettings[section]) {
    replaceUserSettings(mergeUserSettings(activeUserSettings, {
      [section]: { ...defaultUserSettings[section] },
    }), { persist: true, dispatch: true });
  } else {
    replaceUserSettings(cloneDefaultUserSettings(), { persist: true, dispatch: true });
  }
}

function migrateLegacyConfig(settings) {
/* Legacy configs looked like this:

  const defaultConfig = {
  editor: {
    currentTheme: 0,
    fontSize: 16
  },
  storage: {
    savelocal: true,
    autoSaveInterval: 5000 // ms
  },
  ui: {
    consoleLinesLimit: 50
  }
};
  */
  dbg("Checking for legacy config...");
    const editorConfigStr = window.localStorage.getItem("editorConfig");
  if (editorConfigStr) {
    dbg("persistentUserSettings.mjs: Found legacy editor config:", editorConfigStr);

    const editorConfig = JSON.parse(editorConfigStr);
    dbg("persistentUserSettings.mjs: Legacy theme index:", editorConfig.currentTheme);

    // Previously we stored a number, now we store a name
    const themeNames = Object.keys(themes);
    dbg('persistentUserSettings.mjs: Available theme names:', themeNames);
    
    const themeIndex = editorConfig.currentTheme % themeNames.length;
    editorConfig.theme = themeNames[themeIndex];
    dbg('persistentUserSettings.mjs: Converted legacy theme index', themeIndex, 'to name:', editorConfig.theme);
    
    delete editorConfig.currentTheme;

    settings.editor = {
      ...settings.editor,
      ...editorConfig,
    };
    
    // Remove legacy config from local storage
    window.localStorage.removeItem("editorConfig");
  }

  const generalConfigStr = window.localStorage.getItem("useqConfig");
  if (generalConfigStr) {
    dbg("Found general config:", generalConfigStr);
    const generalConfig = JSON.parse(generalConfigStr);


    // Merge storage settings
    if (generalConfig.storage) {
      generalConfig.saveCodeLocally = generalConfig.storage.savelocal;
      delete generalConfig.storage.savelocal;

      settings.storage = {
        ...settings.storage,
        ...generalConfig.storage,
      };
    }

    if (generalConfig.ui) {
      settings.ui = {
        ...settings.ui,
        ...generalConfig.ui,
      };
    }

    // Remove legacy config from local storage
    window.localStorage.removeItem("useqConfig");
  }

  const codeStr =
    window.localStorage.getItem(legacyCodeStorageKey) ?? window.localStorage.getItem(codeStorageKey);
  if (codeStr) {
    dbg("Found code:", codeStr);
    settings.editor.code = decodeStoredCode(codeStr) ?? defaultMainEditorStartingCode;
    // Remove legacy config from local storage
    window.localStorage.removeItem(legacyCodeStorageKey);
  }
  
  return settings;
}

export function deleteLocalStorage() {
  window.localStorage.removeItem(settingsStorageKey);
  window.localStorage.removeItem(codeStorageKey);
  window.localStorage.removeItem("editorConfig");
  window.localStorage.removeItem("useqConfig");
  window.localStorage.removeItem(legacyCodeStorageKey);
  dbg("Local storage cleared.");
}
