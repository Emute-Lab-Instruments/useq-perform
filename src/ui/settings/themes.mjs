import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme, setMainEditorTheme } from "../../editors/themes/themeManager.mjs";
import { baseExtensions } from "../../editors/extensions.mjs";
import { saveUserSettings } from "../../utils/persistentUserSettings.mjs";
import { toggleAuxPanel } from '../ui.mjs';
import { defaultThemeEditorStartingCode } from "../../editors/defaults.mjs";
import { dbg } from "../../utils.mjs";

/**
 * Initialize the theme tab within the settings panel
 */
export function initThemeTab(container) {
    dbg("Initializing theme tab");
    const themesContainer = container;
    
    // Create themes container
    const themesGrid = document.createElement('div');
    themesGrid.className = 'themes-container';
    themesContainer.appendChild(themesGrid);
    
    // Add a title for the panel
    const panelTitle = document.createElement('h2');
    panelTitle.className = 'panel-section-title';
    panelTitle.textContent = 'Select a Theme';
    themesGrid.appendChild(panelTitle);
    
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
            toggleAuxPanel("#pannel-settings");
        });
        
        themesGrid.appendChild(container);
    });
}