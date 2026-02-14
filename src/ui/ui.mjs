import { dbg } from "../utils.mjs";
import { makeVis } from "./serialVis/serialVis.mjs";
import { makeConsole as makeConsole } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { makeToolbar } from "./toolbar.mjs";
import { initGamepadControl } from "../editors/gamepadControl.mjs";
import { makeDevMode, initDevMode } from "./devMode.mjs";

let editor = null;
let topToolbarResizeObserver = null;
let topToolbarResizeListener = null;

const TOP_TOOLBAR_ID = "panel-top-toolbar";
const TOP_TOOLBAR_HEIGHT_VAR = "--top-toolbar-height";

function hasSolidToolbarsMounted() {
    return Boolean(
        document.getElementById("panel-top-toolbar-root") &&
        document.getElementById("panel-toolbar-root")
    );
}

function ensureSolidPanelsMounted() {
    const hasSettingsMount = typeof window.mountSettingsPanel === "function";
    if (hasSettingsMount) {
        window.mountSettingsPanel("panel-settings");
    }

    const hasHelpMount = typeof window.mountHelpPanel === "function";
    if (hasHelpMount) {
        window.mountHelpPanel("panel-help");
    }

    return hasSettingsMount && hasHelpMount;
}

function initTopToolbarHeightTracking() {
    updateTopToolbarHeight();

    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            updateTopToolbarHeight();
        });
    }

    const toolbar = document.getElementById(TOP_TOOLBAR_ID);
    if (!toolbar) {
        return;
    }

    if (typeof ResizeObserver !== "undefined") {
        if (topToolbarResizeObserver) {
            topToolbarResizeObserver.disconnect();
        }
        topToolbarResizeObserver = new ResizeObserver(() => {
            updateTopToolbarHeight();
        });
        topToolbarResizeObserver.observe(toolbar);
    }

    if (!topToolbarResizeListener) {
        topToolbarResizeListener = () => {
            updateTopToolbarHeight();
        };
        window.addEventListener("resize", topToolbarResizeListener, { passive: true });
    }
}

function updateTopToolbarHeight() {
    const toolbar = document.getElementById(TOP_TOOLBAR_ID);
    if (!toolbar) {
        document.documentElement.style.setProperty(TOP_TOOLBAR_HEIGHT_VAR, "0px");
        return;
    }

    const rect = toolbar.getBoundingClientRect();
    const candidateHeights = [rect && rect.height, toolbar.offsetHeight, toolbar.scrollHeight];
    let measuredHeight = 0;
    for (const candidate of candidateHeights) {
        if (typeof candidate === "number" && candidate > measuredHeight) {
            measuredHeight = candidate;
        }
    }

    const resolvedHeight = Number.isFinite(measuredHeight) ? Math.ceil(measuredHeight) : 0;
    document.documentElement.style.setProperty(
        TOP_TOOLBAR_HEIGHT_VAR,
        `${Math.max(0, resolvedHeight)}px`
    );
}

export async function createAppUI(environmentState) {
    // Initialize editor first so we can pass its instance to other panels
    editor = initEditorPanel("#panel-main-editor");
    if (window.__setUseqEditor) {
        window.__setUseqEditor(editor);
    } else {
        window.__useqEditor = editor;
    }
    // Add structure navigation panel to the top of the editor panel
    // const editorPanel = document.querySelector('#panel-main-editor');
    // if (editorPanel) {
    //     editorPanel.prepend(makeStructureNavPanel(editor));
    // }

    // Initialize all UI components
    const consoleComponent = makeConsole();
    const visPanel = makeVis();
    const visPanelEl = document.getElementById("panel-vis");
    if (visPanelEl) visPanelEl.style.display = "none";

    const solidToolbarsMounted = hasSolidToolbarsMounted();
    const solidPanelsMounted = ensureSolidPanelsMounted();

    if (!solidToolbarsMounted) {
        dbg("Solid toolbars not mounted in time; using legacy toolbar fallback");
        makeToolbar(editor);
    }

    if (!solidPanelsMounted) {
        dbg("Solid settings/help panels not mounted in time; legacy panel content will remain");
    }

    initTopToolbarHeightTracking();
    // const helpComponents = await makeHelp();
    // $("#panel-help").append(...helpComponents);

    let devmodeComponent = null;
    // Initialize dev mode panel if dev mode is active
    if (environmentState.isInDevmode) {
        dbg("Dev mode active - initializing dev mode panel");
        devmodeComponent = makeDevMode();
        const devmodeEl = document.getElementById("panel-devmode");
        if (devmodeEl) devmodeEl.appendChild(devmodeComponent);
        initDevMode();
    }

    initGamepadControl(editor);
    initEventHandlers();

    // Return object with all UI components for testing and external access
    return {
        mainEditor: editor,
        serialVis: visPanel,
        settingsPanel: document.getElementById("panel-settings") || null,
        helpPanel: document.getElementById("panel-help") || null,
        logConsole: consoleComponent,
        toolbar: getToolbarComponents(),
        statusBar: getStatusBarComponent(),
        transportControls: getTransportControlsComponent(),
        devmodePanel: devmodeComponent
    };
}

function hideAllAuxPanels() {
    document.querySelectorAll(".panel-aux").forEach(el => el.style.display = "none");
}

function initEventHandlers() {
    // on escape, close all panel-aux
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            hideAllAuxPanels();
        }
    });
}

// Helper functions to extract component references for the return object
function getToolbarComponents() {
    return {
        connectionBtn: document.getElementById("button-connect"),
        visBtn: document.getElementById("button-graph"),
        saveBtn: document.getElementById("button-save"),
        loadBtn: document.getElementById("button-load"),
        fontDecreaseBtn: document.getElementById("button-decrease-font"),
        fontIncreaseBtn: document.getElementById("button-increase-font"),
        undoBtn: document.getElementById("button-undo"),
        redoBtn: document.getElementById("button-redo"),
        helpBtn: document.getElementById("button-help"),
        settingsBtn: document.getElementById("button-settings"),
        devmodeBtn: document.getElementById("button-devmode") // This may not exist if not in devmode
    };
}

function getStatusBarComponent() {
    return document.getElementById("status-bar") || null;
}

function getTransportControlsComponent() {
    return {
        playBtn: document.getElementById("button-play"),
        pauseBtn: document.getElementById("button-pause"),
        stopBtn: document.getElementById("button-stop"),
        rewindBtn: document.getElementById("button-rewind"),
        clearBtn: document.getElementById("button-clear")
    };
}
