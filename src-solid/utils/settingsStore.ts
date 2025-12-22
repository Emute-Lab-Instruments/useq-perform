import { createStore, reconcile } from "solid-js/store";
import { activeUserSettings, updateUserSettings } from "../../src/utils/persistentUserSettings.mjs";

/**
 * SolidJS store for user settings.
 * Wraps the legacy activeUserSettings and provides reactivity.
 */
export const [settings, setSettings] = createStore({ ...activeUserSettings });

/**
 * Updates user settings and ensures they are persisted and the store is updated.
 * @param values Partial settings object to merge
 */
export function updateSettingsStore(values: any) {
  updateUserSettings(values);
  // updateUserSettings dispatches 'useq-settings-changed', 
  // which is handled by the listener below.
}

// Sync store with legacy settings updates
window.addEventListener("useq-settings-changed", (event: any) => {
  setSettings(reconcile(event.detail));
});

// Initial sync to catch any changes made before this module was loaded
setSettings(reconcile(activeUserSettings));
