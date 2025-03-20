export function initConsolePanel() {
    // TODO
    $("#consoleButton").on("click", async () => {
        $("#console-panel").toggle('active');
    });
}