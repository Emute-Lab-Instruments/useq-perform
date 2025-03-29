import { toggleAuxPanel } from './ui.mjs';

export function initSnippetsPanel() {
    $("#snippetsButton").on("click", () => {
        toggleAuxPanel("#panel-snippets");
    });
}