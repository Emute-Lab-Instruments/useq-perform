export function initConsolePanel() {
    // TODO
    $("#consoleButton").on("click", async () => {
        $("#panel-console").toggle('active');
    });
}