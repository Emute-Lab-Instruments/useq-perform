export function initSnippetsPanel() {
    $("#snippetsButton").on("click", () => {
        $("#panel-snippets").toggle();
    });

    // Handle ESC key to close panel
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#panel-snippets").is(":visible")) {
            $("#panel-snippets").hide();
        }
    });
}