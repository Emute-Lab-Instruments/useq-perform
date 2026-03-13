// @ts-nocheck
/**
 * Configuration Schema
 *
 * Defines the structure and default values for the application configuration.
 * This schema is used for validation, migrations, and default initialization.
 */

import {
  CONFIG_VERSION,
  createConfigurationDocument,
  createDefaultUserSettings,
  defaultDevModeConfiguration,
} from "./appSettings.ts";

export { CONFIG_VERSION };

/**
 * Default configuration structure
 * This represents the complete configuration schema with all default values.
 */
export const defaultConfiguration = {
  ...createConfigurationDocument(createDefaultUserSettings(), {
    includeDevMode: true,
    metadataSource: "default",
    metadataDescription: "uSEQ Perform configuration",
  }),
  metadata: {
    lastModified: null,
    source: "default",
    description: "uSEQ Perform configuration",
  },
  devMode: { ...defaultDevModeConfiguration },
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

  if (
    config.user?.visualisation &&
    config.user.visualisation.windowDuration == null
  ) {
    errors.push('user.visualisation.windowDuration is required');
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
  return createConfigurationDocument(activeUserSettings, {
    includeDevMode: true,
    metadataSource: "webapp-export",
  });
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
  if (current.user?.visualisation?.windowDuration !== incoming.user?.visualisation?.windowDuration) {
    diffs.push(`Visual Window: ${current.user?.visualisation?.windowDuration}s → ${incoming.user?.visualisation?.windowDuration}s`);
  }

  if (current.user?.visualisation?.lineWidth !== incoming.user?.visualisation?.lineWidth) {
    diffs.push(`Line Width: ${current.user?.visualisation?.lineWidth}px → ${incoming.user?.visualisation?.lineWidth}px`);
  }

  // Add more comparisons as needed

  return diffs;
}
