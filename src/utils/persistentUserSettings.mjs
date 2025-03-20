/**
 * Configuration Manager Module
 * 
 * Handles application configuration, including loading, saving,
 * and providing defaults.
 */
import { defaultFontSize, defaultTheme, defaultEditorStartingCode } from "../editors/defaults.mjs";
import { themes } from "../editors/themes/themeManager.mjs";

console.log("persistentUserSettings.mjs: Loading with defaults:", { defaultTheme, defaultFontSize });

// Export both the new and old names for backward compatibility
console.log('persistentUserSettings.mjs: Importing with defaultTheme:', defaultTheme);
console.log('persistentUserSettings.mjs: Available themes:', Object.keys(themes));

export const settingsStorageKey = "uSEQ-Perform-User-Settings";
export const codeStorageKey = "uSEQ-Perform-User-Code";

// Default application configuration
const defaultUserSettings = { 
  name: "Livecoder",
  editor: { 
    code: defaultEditorStartingCode,
    theme: defaultTheme,
    fontSize: defaultFontSize },
  storage : {  
    saveCodeLocally: true,
    autoSaveEnabled: true,
    autoSaveInterval: 5000, // ms
  },
  ui: {
    consoleLinesLimit: 1000,
    customThemes: []
  }
};

console.log('persistentUserSettings.mjs: Default settings theme:', defaultUserSettings.editor.theme);

// Active configuration (initialized with defaults)
export let activeUserSettings = { ...defaultUserSettings };
console.log('persistentUserSettings.mjs: Initial active settings theme:', activeUserSettings.editor.theme);

/**
 * Load configuration from localStorage
 * @returns {Object} The merged configuration (defaults + saved values)
 */
export function loadUserSettings() {
  console.log("persistentUserSettings.mjs: Loading user settings...");
  try {
    // Check if the (new) user settings exist in localStorage
    const retrievedSettingsStr = window.localStorage.getItem(settingsStorageKey);
    console.log('persistentUserSettings.mjs: Loading settings from storage:', retrievedSettingsStr);

    // If they exist, parse them and set as active settings
    if (retrievedSettingsStr) {
      const retrievedSettings = JSON.parse(retrievedSettingsStr);
      console.log('persistentUserSettings.mjs: Retrieved settings theme:', retrievedSettings.editor?.theme);
      activeUserSettings = { ...activeUserSettings, ...retrievedSettings };
      console.log("Active user settings:", activeUserSettings);
    } else {
      // If not, check to see if the old settings exist
      console.log('persistentUserSettings.mjs: No settings found, checking legacy config...');
      activeUserSettings = migrateLegacyConfig(activeUserSettings);
      console.log('persistentUserSettings.mjs: Settings after legacy migration:', activeUserSettings.editor.theme);
    }

    // If they don't either, activeUserSettings will have remained default by now
    console.log("Active user settings after migration:", activeUserSettings);
return activeUserSettings;
  } catch (error) {
    console.error("Error loading user settings:", error);
    activeUserSettings = { ...defaultUserSettings };
  }

  // Legacy handling for old theme name
  if (activeUserSettings.editor?.theme === 'default') {
    console.log("persistentUserSettings.mjs: Converting legacy 'default' theme to:", defaultTheme);
    activeUserSettings.editor.theme = defaultTheme;
  }

  if (!themes[activeUserSettings.editor?.theme]) {
    console.log("persistentUserSettings.mjs: Theme not found in available themes, resetting to:", defaultTheme);
    activeUserSettings.editor.theme = defaultTheme;
  }

  console.log("persistentUserSettings.mjs: Final theme value:", activeUserSettings.editor?.theme);
  return activeUserSettings;
}

/**
 * Save current configuration to localStorage
 */
export function saveUserSettings() {
  console.log("persistentUserSettings.mjs: Saving settings with theme:", activeUserSettings.editor?.theme);
  try {

    const code = activeUserSettings.editor.code;
    let settingsWithoutCode = { ...activeUserSettings};
    delete settingsWithoutCode.editor.code;

    console.log("Code: ", code);
    console.log("Code string: ", JSON.stringify(code));
    console.log("Settings without code: ", settingsWithoutCode);
    console.log("Active settings: ", activeUserSettings);

    window.localStorage.setItem(settingsStorageKey, JSON.stringify(activeUserSettings));
    window.localStorage.setItem(codeStorageKey, JSON.stringify(code));
  } catch (error) {
    console.error("Error saving configuration:", error);
  }
}

/**
 * Update a specific section of the configuration
 * @param {string} section - Configuration section to update (e.g., 'editor', 'storage', 'ui')
 * @param {Object} values - New values to merge
 */
export function updateUserSettings(values) {
  console.log("persistentUserSettings.mjs: Updating settings with:", values);
  activeUserSettings = { ...activeUserSettings, ...values };
  saveUserSettings();
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
    activeUserSettings[section] = { ...defaultUserSettings[section] };
  } else {
    activeUserSettings = { ...defaultUserSettings };
  }
  saveUserSettings();
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
  console.log("Checking for legacy config...");
    const editorConfigStr = window.localStorage.getItem("editorConfig");
  if (editorConfigStr) {
    console.log("persistentUserSettings.mjs: Found legacy editor config:", editorConfigStr);

    const editorConfig = JSON.parse(editorConfigStr);
    console.log("persistentUserSettings.mjs: Legacy theme index:", editorConfig.currentTheme);

    // Previously we stored a number, now we store a name
    const themeNames = Object.keys(themes);
    console.log('persistentUserSettings.mjs: Available theme names:', themeNames);
    
    const themeIndex = editorConfig.currentTheme % themeNames.length;
    editorConfig.theme = themeNames[themeIndex];
    console.log('persistentUserSettings.mjs: Converted legacy theme index', themeIndex, 'to name:', editorConfig.theme);
    
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
    console.log("Found general config:", generalConfigStr);
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

  const codeStr = window.localStorage.getItem("codeStorageKey");
  if (codeStr) {
    console.log("Found code:", codeStr);
    settings.editor.code = codeStr;
    // Remove legacy config from local storage
    window.localStorage.removeItem("codeStorageKey");
  }
  
  return settings;
}

export function deleteLocalStorage() {
  window.localStorage.removeItem(settingsStorageKey);
  window.localStorage.removeItem("editorConfig");
  window.localStorage.removeItem("useqConfig");
  window.localStorage.removeItem("codeStorageKey");
  console.log("Local storage cleared.");
}