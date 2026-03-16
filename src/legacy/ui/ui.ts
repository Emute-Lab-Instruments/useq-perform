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
