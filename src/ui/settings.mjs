export function initSettingsPanel() {
    // TODO
    $("#settingsButton").on("click", async () => {
        $("#panel-settings").toggle('active');
    });
}