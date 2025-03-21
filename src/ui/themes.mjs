import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme, setMainEditorTheme } from "../editors/themes/themeManager.mjs";
import { baseExtensions } from "../editors/extensions.mjs";
import { saveUserSettings } from "../utils/persistentUserSettings.mjs";
import { toggleAuxPanel } from './ui.mjs';
import { defaultThemeEditorStartingCode } from "../editors/defaults.mjs";

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
            doc: defaultThemeEditorStartingCode,
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
                setMainEditorTheme(themeName);
                //saveUserSettings();
            }
            //toggleAuxPanel("#panel-theme");
        });

        panel.appendChild(container);
    });

    // Theme button click handler
    $("#button-theme").on("click", () => {
        toggleAuxPanel("#panel-theme");
    });

    // Close on Escape key
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#panel-theme").is(":visible")) {
            toggleAuxPanel("#panel-theme");
        }
    });
}