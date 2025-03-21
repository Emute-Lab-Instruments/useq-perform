import { toggleAuxPanel } from './ui.mjs';

export function initSettingsPanel() {
    $("#settingsButton").on("click", () => {
        toggleAuxPanel("#panel-settings");
    });

    // Handle ESC key to close panel
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#panel-settings").is(":visible")) {
            toggleAuxPanel("#panel-settings");
        }
    });
}