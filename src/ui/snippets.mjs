export function initSnippetsPanel() {
    // TODO
    $("#snippetsButton").on("click", async () => {
        $("#snippets-panel").toggle('active');
    });

}