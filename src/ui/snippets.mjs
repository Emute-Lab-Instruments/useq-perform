import { toggleAuxPanel } from './ui.mjs';

export function initSnippetsPanel() {
    $("#snippetsButton").on("click", () => {
        toggleAuxPanel("#panel-snippets");
    });

    // Handle ESC key to close panel
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#panel-snippets").is(":visible")) {
            toggleAuxPanel("#panel-snippets");
        }
    });
}