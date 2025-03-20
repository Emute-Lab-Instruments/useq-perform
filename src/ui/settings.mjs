export function initSettingsPanel() {
    $("#settingsButton").on("click", () => {
        $("#panel-settings").toggle();
    });

    // Handle ESC key to close panel
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#panel-settings").is(":visible")) {
            $("#panel-settings").hide();
        }
    });
}