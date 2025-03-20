import { initHelpPanel } from './help.mjs';
import { initIcons } from './icons.mjs';
import { initVisPanel } from "./serialVis.mjs";   
import { initConsolePanel } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { initSettingsPanel } from "./settings.mjs";
import { initToolbarPanel } from "./toolbar.mjs";
import { initThemePanel } from "./themes.mjs";
import { initSnippetsPanel } from "./snippets.mjs";

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