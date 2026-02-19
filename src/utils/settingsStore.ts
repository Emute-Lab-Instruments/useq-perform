import { createStore, reconcile } from "solid-js/store";
import { activeUserSettings, updateUserSettings } from "../legacy/utils/persistentUserSettings.ts";

/**
 * SolidJS store for user settings.
 * Wraps the legacy activeUserSettings and provides reactivity.
 */
export const [settings, setSettings] = createStore({ ...activeUserSettings });

/**
 * Updates user settings and ensures they are persisted and the store is updated.
 * @param values Partial settings object to merge into the active settings
 */
export function updateSettingsStore(values: Record<string, unknown>) {
  updateUserSettings(values);
  // updateUserSettings dispatches 'useq-settings-changed',
  // which is handled by the listener below.
}

// Sync store with legacy settings updates
window.addEventListener("useq-settings-changed", (event: Event) => {
  const detail = (event as CustomEvent<typeof activeUserSettings>).detail;
  setSettings(reconcile(detail));
});

// Initial sync to catch any changes made before this module was loaded
setSettings(reconcile(activeUserSettings));
