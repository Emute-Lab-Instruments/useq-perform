import { initEditorPanel } from "../editors/main.ts";
import { initGamepadControl } from "../editors/gamepadControl.ts";
import { devmode } from "../urlParams.ts";

let editor: any = null;
let topToolbarResizeObserver: ResizeObserver | null = null;
let topToolbarResizeListener: (() => void) | null = null;

const TOP_TOOLBAR_ID = "panel-top-toolbar";
const TOP_TOOLBAR_HEIGHT_VAR = "--top-toolbar-height";

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

export async function createAppUI(environmentState: any) {
    editor = initEditorPanel("#panel-main-editor");

    const visPanelEl = document.getElementById("panel-vis");
    if (visPanelEl) visPanelEl.style.display = "none";

    // Mount Solid UI adapters and wire editor store.
    // The try/catch handles Node.js test environments where .tsx/.ts Solid imports fail.
    try {
        const [editorStore, panels, toolbars] = await Promise.all([
            import("../../lib/editorStore.ts"),
            import("../../ui/adapters/panels.tsx"),
            import("../../ui/adapters/toolbars.tsx"),
        ]);
        editorStore.setEditor(editor);
        // Mount toolbars first (they replace the static HTML toolbar elements)
        toolbars.mountTransportToolbar();
        toolbars.mountMainToolbar();
        // Mount panels and design selector
        panels.mountSettingsPanel();
        panels.mountHelpPanel();
        panels.mountDesignSelector(devmode);
    } catch (_) {
        // In Node.js test environments, Solid imports fail gracefully — no-op.
    }

    initTopToolbarHeightTracking();

    initGamepadControl(editor);
    initEventHandlers();

    return {
        mainEditor: editor,
        serialVis: document.getElementById("panel-vis") || null,
        settingsPanel: document.getElementById("panel-settings") || null,
        helpPanel: document.getElementById("panel-help") || null,
        logConsole: null,
        statusBar: getStatusBarComponent(),
    };
}

function initEventHandlers() {
    document.addEventListener("keydown", function (e: KeyboardEvent) {
        if (e.key === "Escape") {
            // Hide chrome-managed panels via adapter signal
            import("../../ui/adapters/panels.tsx")
              .then((m) => m.hideAllPanels())
              .catch(() => {});
            // Also hide any legacy .panel-aux elements (e.g. devmode)
            document.querySelectorAll(".panel-aux").forEach(el => {
                (el as HTMLElement).style.display = "none";
            });
        }
    });
}

function getStatusBarComponent() {
    return document.getElementById("status-bar") || null;
}
