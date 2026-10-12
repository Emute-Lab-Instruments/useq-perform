import {
  settingsChanged as settingsChangedChannel,
} from "../contracts/runtimeChannels";
import type { AppSettings } from "../lib/appSettings";
import {
  getAppSettings,
  replaceAppSettings as _replaceAppSettings,
  updateAppSettings as _updateAppSettings,
  resetAppSettings as _resetAppSettings,
} from "./appSettingsRepository";
import { configureInstalledBrowserWasmRuntime } from "./browserWasmRuntime.ts";

function syncRuntimeSettings(settings: AppSettings): void {
  void configureInstalledBrowserWasmRuntime(settings.wasm.enabled);
}

// ── Settings mutations (sole public surface) ────────────────────
//
// All settings mutations from outside src/runtime/ MUST go through
// these methods.  appSettingsRepository write exports are for internal
// use only (bootstrap + this module).

/**
 * Replace all settings wholesale (e.g. after loading from bootstrap).
 * This is the only public API for full settings replacement.
 */
export function replaceSettings(
  values: unknown,
  options?: { persist?: boolean; dispatch?: boolean },
): AppSettings {
  const result = _replaceAppSettings(values, { persist: options?.persist });
  if (options?.dispatch) syncRuntimeSettings(result);
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Merge a partial settings patch into active settings, persist, and dispatch.
 * This is the primary mutation path for incremental settings changes.
 */
export function updateSettings(
  values: unknown,
  options?: { persist?: boolean },
): AppSettings {
  const result = _updateAppSettings(values, options);
  syncRuntimeSettings(result);
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Reset settings to defaults (optionally a single section).
 */
export function resetSettings(section?: keyof AppSettings): AppSettings {
  const result = _resetAppSettings(section);
  syncRuntimeSettings(result);
  settingsChangedChannel.publish(result);
  return result;
}

/**
 * Read current settings snapshot (read-only, no mutation).
 */
export function getSettings(): AppSettings {
  return getAppSettings();
}
