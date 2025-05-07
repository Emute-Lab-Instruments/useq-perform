import { dbg } from "../utils.mjs";
import { makeHelp } from './help/help.mjs';
import { initIcons } from './icons.mjs';
import { makeVis } from "./serialVis/serialVis.mjs";
import { makeConsole as makeConsole } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { makeSettings as makeSettings } from "./settings/settings.mjs";
import { makeToolbar } from "./toolbar.mjs";
import { initSnippetsPanel } from "./snippets.mjs";
import { initVisLegend } from "./visLegend.mjs";
import { isPanelVisible } from "./utils.mjs";
import {
    navigateOut,
    navigateIn,
    navigatePrev,
    navigateNext,
    // navigateToTopLevel
} from "../editors/extensions/structure.mjs";
import { initGamepadControl } from "../editors/gamepadControl.mjs";

function makeStructureNavPanel(editor) {
    const panel = document.createElement('div');
    panel.id = 'structure-nav-panel';
    panel.style = 'padding: 8px; background: #f5f5f5; border: 1px solid #ccc; margin: 8px 0; display: flex; gap: 8px;';

    const btns = [
        { label: 'Out', action: navigateOut },
        { label: 'In', action: navigateIn },
        { label: 'Prev', action: navigatePrev },
        { label: 'Next', action: navigateNext },
        // { label: 'Top', action: navigateToTopLevel }
    ];

    btns.forEach(({ label, action }) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.onclick = () => {
            const tr = action(editor.state);
            if (tr) editor.dispatch(tr);
        };
        panel.appendChild(btn);
    });
    return panel;
}

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

export async function initUI() {
    // Initialize editor first so we can pass its instance to other panels
    editor = initEditorPanel("#panel-main-editor");
    // Add structure navigation panel to the top of the editor panel
    const editorPanel = document.querySelector('#panel-main-editor');
    if (editorPanel) {
        editorPanel.prepend(makeStructureNavPanel(editor));
    }
    makeToolbar(editor);
    makeConsole();

    makeVis();
    $("#panel-vis").hide();

    $("#panel-settings").append(...makeSettings());

    $("#panel-help").append(...await makeHelp());

    initGamepadControl(editor);
    initEventHandlers();
}

function initEventHandlers() {
    // on escape, close all panel-aux
    $(document).on("keydown", function (e) {
        // console.log("Key pressed:", e.key);
        if (e.key === "Escape") {
            $(".panel-aux").hide();
        }
    });
}