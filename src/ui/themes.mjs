import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme } from "../editors/themes/themeManager.mjs";
import { baseExtensions } from "../editors/extensions.mjs";
import { interfaceStates, panelStates, togglePanelState } from "./panelStates.mjs";
import { saveUserSettings } from "../utils/persistentUserSettings.mjs";

export function initThemePanel() {
    // Create theme preview editors
    const panel = document.getElementById("panel-theme");
    
    // Create preview editors for each theme
    Object.entries(themes).forEach(([themeName, themeExtension]) => {
        const container = document.createElement("div");
        container.className = "theme-preview";
        
        const label = document.createElement("div");
        label.textContent = themeName;
        label.className = "theme-name";
        container.appendChild(label);

        // Create editor with this theme
        const state = EditorState.create({
            doc: "(hello this is an editor)",
            extensions: [
                ...baseExtensions,
                themeExtension
            ]
        });

        const view = new EditorView({
            state,
            parent: container
        });

        setTheme(view, themeName);

        // Make editor read-only
        view.contentDOM.setAttribute("contenteditable", "false");
        
        // Add click handler to apply theme
        container.addEventListener("click", () => {
            const mainEditor = EditorView.findFromDOM(document.querySelector("#panel-main-editor .cm-editor"));
            if (mainEditor) {
                setTheme(mainEditor, themeName);
                saveUserSettings();
            }
            // Close panel after selection
            togglePanelState('themePanel', 'panel-theme');
        });

        panel.appendChild(container);
    });

    // Theme button click handler
    $("#themeButton").on("click", () => {
        togglePanelState('themePanel', 'panel-theme');
    });

    // Close on Escape key
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && interfaceStates.themePanelState === panelStates.PANEL) {
            togglePanelState('themePanel', 'panel-theme');
        }
    });
}