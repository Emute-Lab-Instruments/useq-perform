import { createSignal } from "solid-js";

/**
 * Shared search query signal for the settings panel.
 * When non-empty, sections auto-expand and non-matching rows are hidden.
 */
export const [settingsQuery, setSettingsQuery] = createSignal("");
