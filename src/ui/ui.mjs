import { initHelpPanel } from './help.mjs';
import { initIcons } from './icons.mjs';
import { initVisPanel } from "./serialVis.mjs";   
import { initConsolePanel } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { initSettingsPanel } from "./settings.mjs";
import { initToolbarPanel } from "./toolbar.mjs";
import { initThemePanel } from "./themes.mjs";
import { initSnippetsPanel } from "./snippets.mjs";

export function toggleAuxPanel(panelID) {
    const $panel = $(panelID);
    // Check both display and visibility to determine true visible state
    const isVisible = $panel.css("display") !== "none" && $panel.css("visibility") !== "hidden";
    
    // First, ensure all panels are fully hidden
    $(".panel-aux").css({
        "display": "none",
        "visibility": "hidden",
        "opacity": "0"
    });
    
    if (!isVisible) {
        // Force a reflow to ensure transitions work
        $panel[0].offsetHeight;
        
        // Show the requested panel immediately
        $panel.css({
            "display": "block",
            "visibility": "visible",
            "opacity": "1"
        });
    }
}

function initPanels(){
    // Initialize editor first so we can pass its instance to other panels
    const editor = initEditorPanel();
    
    // Initialize other panels
    initConsolePanel();
    initHelpPanel();
    initSettingsPanel();
    initToolbarPanel(editor);
    initThemePanel();
    initVisPanel();
    initSnippetsPanel();
    
    return editor;
}

export function initUI() {
    initIcons();
    const editor = initPanels();
    return editor;
}