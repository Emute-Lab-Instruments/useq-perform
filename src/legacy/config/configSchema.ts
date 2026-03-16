/**
 * Re-export from canonical location.
 * Legacy code should migrate to import from src/runtime/configSchema.ts directly.
 */
export {
  CONFIG_VERSION,
  defaultConfiguration,
  validateConfiguration,
  mergeConfigurations,
  extractConfiguration,
  needsMigration,
  getConfigurationDiff,
} from "../../runtime/configSchema.ts";
