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
import { makeDevMode, initDevMode } from "./devMode.mjs";

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

export async function createAppUI(environmentState) {
    // Initialize editor first so we can pass its instance to other panels
    editor = initEditorPanel("#panel-main-editor");
    // Add structure navigation panel to the top of the editor panel
    // const editorPanel = document.querySelector('#panel-main-editor');
    // if (editorPanel) {
    //     editorPanel.prepend(makeStructureNavPanel(editor));
    // }

    // Initialize all UI components
    const toolbarComponents = makeToolbar(editor);
    const consoleComponent = makeConsole();
    const visPanel = makeVis();
    $("#panel-vis").hide();

    const settingsComponents = makeSettings();
    $("#panel-settings").append(...settingsComponents);

    const helpComponents = await makeHelp();
    $("#panel-help").append(...helpComponents);

    let devmodeComponent = null;
    // Initialize dev mode panel if dev mode is active
    if (environmentState.isInDevmode) {
        dbg("Dev mode active - initializing dev mode panel");
        devmodeComponent = makeDevMode();
        $("#panel-devmode").append(devmodeComponent);
        initDevMode();
    }

    initGamepadControl(editor);
    initEventHandlers();

    // Return object with all UI components for testing and external access
    return {
        mainEditor: editor,
        serialVis: visPanel,
        settingsPanel: settingsComponents,
        helpPanel: helpComponents,
        logConsole: consoleComponent,
        toolbar: getToolbarComponents(),
        statusBar: getStatusBarComponent(),
        transportControls: getTransportControlsComponent(),
        devmodePanel: devmodeComponent
    };
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

// Helper functions to extract component references for the return object
function getToolbarComponents() {
    return {
        connectionBtn: $("#button-connect")[0],
        visBtn: $("#button-graph")[0],
        saveBtn: $("#button-save")[0],
        loadBtn: $("#button-load")[0],
        fontDecreaseBtn: $("#button-decrease-font")[0],
        fontIncreaseBtn: $("#button-increase-font")[0],
        undoBtn: $("#button-undo")[0],
        redoBtn: $("#button-redo")[0],
        helpBtn: $("#button-help")[0],
        settingsBtn: $("#button-settings")[0],
        devmodeBtn: $("#button-devmode")[0] // This may not exist if not in devmode
    };
}

function getStatusBarComponent() {
    return $("#status-bar")[0] || null;
}

function getTransportControlsComponent() {
    return {
        playBtn: $("#button-play")[0],
        pauseBtn: $("#button-pause")[0],
        stopBtn: $("#button-stop")[0],
        rewindBtn: $("#button-rewind")[0],
        clearBtn: $("#button-clear")[0]
    };
}