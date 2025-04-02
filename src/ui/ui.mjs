import { dbg } from "../utils.mjs";
import { makeHelpPanel as makeHelp } from './help/help.mjs';
import { initIcons } from './icons.mjs';
import { makeVis as makeVis } from "./serialVis.mjs";   
import { makeConsole as makeConsole } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { makeSettings as makeSettings } from "./settings/settings.mjs";
import { makeToolbar } from "./toolbar.mjs";
import { initSnippetsPanel } from "./snippets.mjs";
import { initVisLegend } from "./visLegend.mjs";
import { isPanelVisible } from "./utils.mjs";

// List of panels that support position toggling
const POSITION_TOGGLABLE_PANELS = [
    "panel-help",
    "panel-settings"
];

/**
 * Get icon HTML for position toggle button
 */
function getPositionIcon(position) {
    if (position === 'side') {
        return '◀';
    } else {
        return '▶';
    }
}

let editor = null;

export function initUI() {
    dbg("initUI");
     // Initialize editor first so we can pass its instance to other panels
    editor = initEditorPanel("#panel-main-editor");
    makeToolbar(editor);
    makeConsole();
    makeVis();
    $("#panel-vis").hide();
    $("#panel-settings").append(...makeSettings());
    $("#panel-settings").show();
    
    $("#panel-help").hide();
    // $("#panel-settings").hide();
    // $("#button-settings").on("click", () => {
    //     dbg("toggle settings");
    //     $("#panel-settings").toggle();
    // });

    // //  $("#panel-help").append(makeHelp()).hide();
}