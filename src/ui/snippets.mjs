export function initSnippetsPanel() {
    // TODO
    $("#snippetsButton").on("click", async () => {
        $("#panel-snippets").toggle('active');
    });

}