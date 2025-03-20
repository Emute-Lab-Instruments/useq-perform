export function initSettingsPanel() {
    // TODO
    $("#settingsButton").on("click", async () => {
        $("#settings-panel").toggle('active');
    });
}