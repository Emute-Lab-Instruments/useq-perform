/**
 * Configuration Manager Module
 * 
 * Handles application configuration, including loading, saving,
 * and providing defaults.
 */

export { loadConfig, saveConfig, updateConfig, getConfig, resetConfig };

// Default application configuration
const defaultConfig = {
  // Editor settings
  editor: {
    currentTheme: 0,
    fontSize: 16
  },
  // Storage settings
  storage: {
    savelocal: true,
    autoSaveInterval: 5000 // ms
  },
  // UI settings
  ui: {
    consoleLinesLimit: 50
  }
};

// Active configuration (initialized with defaults)
let activeConfig = { ...defaultConfig };

/**
 * Load configuration from localStorage
 * @returns {Object} The merged configuration (defaults + saved values)
 */
function loadConfig() {
  try {
    // Load editor config
    const editorConfigStr = window.localStorage.getItem("editorConfig");
    if (editorConfigStr) {
      const editorConfig = JSON.parse(editorConfigStr);
      activeConfig.editor = {
        ...activeConfig.editor,
        ...editorConfig
      };
    }
    
    // Load general config
    const generalConfigStr = window.localStorage.getItem("useqConfig");
    if (generalConfigStr) {
      const generalConfig = JSON.parse(generalConfigStr);
      
      // Merge storage settings
      if (generalConfig.storage) {
        activeConfig.storage = {
          ...activeConfig.storage,
          ...generalConfig.storage
        };
      }
      
      // Merge UI settings
      if (generalConfig.ui) {
        activeConfig.ui = {
          ...activeConfig.ui,
          ...generalConfig.ui
        };
      }
    }
    
    return activeConfig;
  } catch (error) {
    console.error("Error loading configuration:", error);
    return defaultConfig;
  }
}

/**
 * Save current configuration to localStorage
 */
function saveConfig() {
  try {
    // Save editor-specific config separately for backward compatibility
    window.localStorage.setItem("editorConfig", JSON.stringify(activeConfig.editor));
    
    // Save general config
    const generalConfig = {
      storage: activeConfig.storage,
      ui: activeConfig.ui
    };
    
    window.localStorage.setItem("useqConfig", JSON.stringify(generalConfig));
  } catch (error) {
    console.error("Error saving configuration:", error);
  }
}

/**
 * Update a specific section of the configuration
 * @param {string} section - Configuration section to update (e.g., 'editor', 'storage', 'ui')
 * @param {Object} values - New values to merge
 */
function updateConfig(section, values) {
  if (activeConfig[section]) {
    activeConfig[section] = {
      ...activeConfig[section],
      ...values
    };
    saveConfig();
  }
}

/**
 * Get the current active configuration
 * @param {string} [section] - Optional section to retrieve (retrieves full config if omitted)
 * @returns {Object} Current configuration or section
 */
function getConfig(section) {
  if (section && activeConfig[section]) {
    return activeConfig[section];
  }
  return activeConfig;
}

/**
 * Reset configuration to defaults
 * @param {string} [section] - Optional section to reset (resets all if omitted)
 */
function resetConfig(section) {
  if (section && defaultConfig[section]) {
    activeConfig[section] = { ...defaultConfig[section] };
  } else {
    activeConfig = { ...defaultConfig };
  }
  saveConfig();
}