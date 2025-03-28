import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme, setMainEditorTheme } from "../editors/themes/themeManager.mjs";
import { baseExtensions } from "../editors/extensions.mjs";
import { saveUserSettings } from "../utils/persistentUserSettings.mjs";
import { toggleAuxPanel } from './ui.mjs';
import { defaultThemeEditorStartingCode } from "../editors/defaults.mjs";

export function initThemePanel() {
    // Get theme panel element
    const panel = document.getElementById("panel-theme");
    
    // Create a container for the themes
    const themesContainer = document.createElement('div');
    themesContainer.className = 'themes-container';
    panel.appendChild(themesContainer);
    
    // Add a title for the panel
    const panelTitle = document.createElement('h2');
    panelTitle.className = 'panel-section-title';
    panelTitle.textContent = 'Select a Theme';
    themesContainer.appendChild(panelTitle);
    
    // Create preview editors for each theme
    Object.entries(themes).forEach(([themeName, themeExtension]) => {
        const container = document.createElement("div");
        container.className = "theme-preview panel-section";
        
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
                saveUserSettings();
            }
            toggleAuxPanel("#panel-theme");
        });
        
        themesContainer.appendChild(container);
    });
    
    // Remove previous handlers if any
    $("#button-theme").off("click");
    
    // Theme button click handler - using direct DOM for reliability
    const themeButton = document.getElementById("button-theme");
    if (themeButton) {
        themeButton.addEventListener("click", function(e) {
            console.log("Theme button clicked - direct event listener");
            toggleAuxPanel("#panel-theme");
            
            // Prevent event bubbling issues
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    // Handle ESC key to close panel
    $(document).keydown((e) => {
        if (e.key === "Escape") {
            if (window.getComputedStyle(panel).display !== "none") {
                console.log("ESC key pressed while theme panel is visible - closing panel");
                toggleAuxPanel("#panel-theme");
                e.preventDefault();
                e.stopPropagation();
            }
        }
    });
}