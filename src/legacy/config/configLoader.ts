/**
 * Transitional compatibility wrappers for settings bootstrap.
 *
 * The canonical owner now lives in `src/runtime/appSettingsRepository.ts`.
 * Keep this module as a stable import path while legacy callers are retired.
 */

import {
  loadBootstrapSettingsWithMetadata,
  loadDefaultConfiguration,
  loadLocalStorageConfiguration,
  loadURLConfiguration,
} from "../../runtime/appSettingsRepository.ts";
import { getStartupFlagsSnapshot } from "../../runtime/startupContext.ts";

export {
  loadDefaultConfiguration,
  loadLocalStorageConfiguration,
  loadURLConfiguration,
};

export async function loadConfiguration() {
  const result = await loadConfigurationWithMetadata();
  return result.config;
}

export function loadConfigurationWithMetadata() {
  return loadBootstrapSettingsWithMetadata();
}

export function loadDevModeConfiguration() {
  if (!getStartupFlagsSnapshot().devmode) {
    return null;
  }

  try {
    const devModeStr = window.localStorage.getItem("uSEQ-Perform-DevMode-State");
    if (!devModeStr) {
      return null;
    }

    return JSON.parse(devModeStr);
  } catch (error) {
    console.error("configLoader: Failed to load DevMode config:", error);
    return null;
  }
}

export function saveDevModeConfiguration(devModeConfig: unknown) {
  try {
    window.localStorage.setItem(
      "uSEQ-Perform-DevMode-State",
      JSON.stringify(devModeConfig),
    );
  } catch (error) {
    console.error("configLoader: Failed to save DevMode config:", error);
  }
}
