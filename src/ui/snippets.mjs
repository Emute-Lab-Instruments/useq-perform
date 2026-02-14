

export function initSnippetsPanel() {
    const btn = document.getElementById("snippetsButton");
    if (btn) {
        btn.addEventListener("click", () => {
            toggleAuxPanel("#panel-snippets");
        });
    }
}
