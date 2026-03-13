import { initEditorPanel } from "../editors/main.ts";
import { initGamepadControl } from "../editors/gamepadControl.ts";
import { reportBootstrapFailure } from "../../runtime/runtimeDiagnostics.ts";
import { registerVisualisationPanel } from "../../ui/adapters/visualisationPanel";
// Static imports: these modules are also imported statically by other modules
// (application.ts, gamepadControl.ts, effects/editor.ts, etc.) so dynamic imports
// would never move them to a separate chunk.
import { setEditor } from "../../lib/editorStore.ts";
import { mountModal } from "../../ui/adapters/modal.tsx";
import { mountPickerMenu } from "../../ui/adapters/picker-menu.tsx";
import { mountDoubleRadialMenu } from "../../ui/adapters/double-radial-menu.tsx";

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
    registerVisualisationPanel(visPanelEl);
    if (visPanelEl) visPanelEl.style.display = "none";

    // Mount Solid UI adapters and wire editor store.
    // panels.tsx and toolbars.tsx are loaded dynamically so Vite can split them into
    // separate chunks. The try/catch guards against mount-time failures.
    try {
        const [panels, toolbars] = await Promise.all([
            import("../../ui/adapters/panels.tsx"),
            import("../../ui/adapters/toolbars.tsx"),
        ]);
        setEditor(editor);
        // Mount toolbars first (they replace the static HTML toolbar elements)
        toolbars.mountTransportToolbar();
        toolbars.mountMainToolbar();
        mountModal();
        mountPickerMenu();
        mountDoubleRadialMenu();
        // Mount panels and design selector
        panels.mountSettingsPanel();
        panels.mountHelpPanel();
        panels.mountDesignSelector(environmentState?.startupFlags?.devmode === true);
    } catch (error) {
        reportBootstrapFailure("ui-adapter-mount", error);
    }

    initTopToolbarHeightTracking();

    initGamepadControl(editor);

    return {
        mainEditor: editor,
        serialVis: document.getElementById("panel-vis") || null,
        logConsole: null,
        statusBar: getStatusBarComponent(),
    };
}

function getStatusBarComponent() {
    return document.getElementById("status-bar") || null;
}
