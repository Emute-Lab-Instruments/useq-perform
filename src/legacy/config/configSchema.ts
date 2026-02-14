/**
 * Configuration Schema
 *
 * Defines the structure and default values for the application configuration.
 * This schema is used for validation, migrations, and default initialization.
 */

export const CONFIG_VERSION = "1.0.0";

/**
 * Default configuration structure
 * This represents the complete configuration schema with all default values.
 */
export const defaultConfiguration = {
  version: CONFIG_VERSION,
  metadata: {
    lastModified: null,
    source: "default",
    description: "uSEQ Perform configuration"
  },
  user: {
    name: "Livecoder",
    editor: {
      theme: "uSEQ Dark",
      fontSize: 16,
      preventBracketUnbalancing: true
    },
    storage: {
      saveCodeLocally: true,
      autoSaveEnabled: true,
      autoSaveInterval: 5000
    },
    ui: {
      consoleLinesLimit: 1000,
      customThemes: [],
      osFamily: "pc",
      expressionGutterEnabled: true,
      expressionLastTrackingEnabled: true,
      expressionClearButtonEnabled: true,
      gamepadPickerStyle: "grid"
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
    }
  },
  devMode: {
    enabled: false,
    mockConnection: {
      autoConnect: false
    },
    mockControls: {
      ain1: 0.5,
      ain2: 0.5,
      din1: 0,
      din2: 0,
      swm: 0,
      swt: 0.5
    }
  }
};

/**
 * Validate a configuration object
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result with { valid: boolean, errors: string[] }
 */
export function validateConfiguration(config) {
  const errors = [];

  // Check required top-level fields
  if (!config) {
    return { valid: false, errors: ['Configuration is null or undefined'] };
  }

  if (!config.version) {
    errors.push('Missing version field');
  }

  if (!config.user) {
    errors.push('Missing user field');
  } else {
    // Validate user section
    if (!config.user.editor) {
      errors.push('Missing user.editor field');
    }
    if (!config.user.storage) {
      errors.push('Missing user.storage field');
    }
    if (!config.user.ui) {
      errors.push('Missing user.ui field');
    }
    if (!config.user.visualisation) {
      errors.push('Missing user.visualisation field');
    }
  }

  // Validate types for critical fields
  if (config.user?.editor?.fontSize) {
    const fontSize = config.user.editor.fontSize;
    if (typeof fontSize !== 'number' || fontSize < 8 || fontSize > 32) {
      errors.push('user.editor.fontSize must be a number between 8 and 32');
    }
  }

  if (config.user?.storage?.autoSaveInterval) {
    const interval = config.user.storage.autoSaveInterval;
    if (typeof interval !== 'number' || interval < 1000) {
      errors.push('user.storage.autoSaveInterval must be a number >= 1000');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Deep merge two configuration objects
 * @param {Object} target - Base configuration
 * @param {Object} source - Configuration to merge in
 * @returns {Object} Merged configuration
 */
export function mergeConfigurations(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Recursively merge objects
      if (key in result && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = mergeConfigurations(result[key], source[key]);
      } else {
        result[key] = { ...source[key] };
      }
    } else {
      // Directly assign primitives and arrays
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Extract configuration from active user settings
 * @param {Object} activeUserSettings - Current active settings
 * @returns {Object} Configuration object matching schema
 */
export function extractConfiguration(activeUserSettings) {
  return {
    version: CONFIG_VERSION,
    metadata: {
      lastModified: new Date().toISOString(),
      source: "webapp-export"
    },
    user: {
      name: activeUserSettings.name || defaultConfiguration.user.name,
      editor: {
        theme: activeUserSettings.editor?.theme || defaultConfiguration.user.editor.theme,
        fontSize: activeUserSettings.editor?.fontSize || defaultConfiguration.user.editor.fontSize,
        preventBracketUnbalancing: activeUserSettings.editor?.preventBracketUnbalancing ?? defaultConfiguration.user.editor.preventBracketUnbalancing
      },
      storage: {
        saveCodeLocally: activeUserSettings.storage?.saveCodeLocally ?? defaultConfiguration.user.storage.saveCodeLocally,
        autoSaveEnabled: activeUserSettings.storage?.autoSaveEnabled ?? defaultConfiguration.user.storage.autoSaveEnabled,
        autoSaveInterval: activeUserSettings.storage?.autoSaveInterval || defaultConfiguration.user.storage.autoSaveInterval
      },
      ui: {
        consoleLinesLimit: activeUserSettings.ui?.consoleLinesLimit || defaultConfiguration.user.ui.consoleLinesLimit,
        customThemes: activeUserSettings.ui?.customThemes || defaultConfiguration.user.ui.customThemes,
        osFamily: activeUserSettings.ui?.osFamily || defaultConfiguration.user.ui.osFamily,
        expressionGutterEnabled: activeUserSettings.ui?.expressionGutterEnabled ?? defaultConfiguration.user.ui.expressionGutterEnabled,
        expressionLastTrackingEnabled: activeUserSettings.ui?.expressionLastTrackingEnabled ?? defaultConfiguration.user.ui.expressionLastTrackingEnabled,
        expressionClearButtonEnabled: activeUserSettings.ui?.expressionClearButtonEnabled ?? defaultConfiguration.user.ui.expressionClearButtonEnabled,
        gamepadPickerStyle: activeUserSettings.ui?.gamepadPickerStyle || defaultConfiguration.user.ui.gamepadPickerStyle
      },
      visualisation: {
        offsetSeconds: activeUserSettings.visualisation?.offsetSeconds ?? defaultConfiguration.user.visualisation.offsetSeconds,
        sampleCount: activeUserSettings.visualisation?.sampleCount || defaultConfiguration.user.visualisation.sampleCount,
        lineWidth: activeUserSettings.visualisation?.lineWidth ?? defaultConfiguration.user.visualisation.lineWidth,
        futureDashed: activeUserSettings.visualisation?.futureDashed ?? defaultConfiguration.user.visualisation.futureDashed,
        futureMaskOpacity: activeUserSettings.visualisation?.futureMaskOpacity ?? defaultConfiguration.user.visualisation.futureMaskOpacity,
        futureMaskWidth: activeUserSettings.visualisation?.futureMaskWidth || defaultConfiguration.user.visualisation.futureMaskWidth,
        circularOffset: activeUserSettings.visualisation?.circularOffset ?? defaultConfiguration.user.visualisation.circularOffset,
        digitalLaneGap: activeUserSettings.visualisation?.digitalLaneGap ?? defaultConfiguration.user.visualisation.digitalLaneGap
      }
    },
    devMode: defaultConfiguration.devMode
  };
}

/**
 * Check if a configuration needs migration
 * @param {Object} config - Configuration to check
 * @returns {boolean} True if migration is needed
 */
export function needsMigration(config) {
  return config.version !== CONFIG_VERSION;
}

/**
 * Get a human-readable summary of configuration differences
 * @param {Object} current - Current configuration
 * @param {Object} incoming - Incoming configuration
 * @returns {string[]} Array of difference descriptions
 */
export function getConfigurationDiff(current, incoming) {
  const diffs = [];

  // Compare theme
  if (current.user?.editor?.theme !== incoming.user?.editor?.theme) {
    diffs.push(`Theme: ${current.user?.editor?.theme} → ${incoming.user?.editor?.theme}`);
  }

  // Compare font size
  if (current.user?.editor?.fontSize !== incoming.user?.editor?.fontSize) {
    diffs.push(`Font Size: ${current.user?.editor?.fontSize} → ${incoming.user?.editor?.fontSize}`);
  }

  // Compare visualisation settings
  if (current.user?.visualisation?.offsetSeconds !== incoming.user?.visualisation?.offsetSeconds) {
    diffs.push(`Visual Offset: ${current.user?.visualisation?.offsetSeconds}s → ${incoming.user?.visualisation?.offsetSeconds}s`);
  }

  if (current.user?.visualisation?.lineWidth !== incoming.user?.visualisation?.lineWidth) {
    diffs.push(`Line Width: ${current.user?.visualisation?.lineWidth}px → ${incoming.user?.visualisation?.lineWidth}px`);
  }

  // Add more comparisons as needed

  return diffs;
}
