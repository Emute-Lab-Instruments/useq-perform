

export function initSnippetsPanel() {
    $("#snippetsButton").on("click", () => {
        toggleAuxPanel("#panel-snippets");
    });
}