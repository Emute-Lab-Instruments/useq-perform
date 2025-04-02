import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme, setMainEditorTheme } from "../../editors/themes/themeManager.mjs";
import { baseExtensions } from "../../editors/extensions.mjs";
import { saveUserSettings } from "../../utils/persistentUserSettings.mjs";
import { defaultThemeEditorStartingCode } from "../../editors/defaults.mjs";
import { dbg } from "../../utils.mjs";

/**
 * Initialize the theme tab within the settings panel
 */
export function makeThemeTab() {
    dbg("Initializing theme tab");
    
    // Create themes container
    const $themesGrid = $('<div>', {
        class: 'panel-tab-content themes-container',
        id: 'panel-settings-themes'
    });
    
    // Add a title for the panel
    const $panelTitle = $('<h2>', {
        class: 'panel-section-title',
        text: 'Select a Theme'
    });
    $themesGrid.append($panelTitle);
    
    // Create preview editors for each theme
    Object.entries(themes).forEach(([themeName, themeExtension]) => {
        const $container = $('<div>', {
            class: 'theme-preview panel-section'
        });
        
        const $label = $('<div>', {
            class: 'theme-name',
            text: themeName
        });
        $container.append($label);
        
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
            parent: $container[0]
        });
        
        setTheme(view, themeName);
        
        // Make editor read-only
        $(view.contentDOM).attr('contenteditable', 'false');
        
        // Add click handler to apply theme
        $container.on('click', () => {
            const mainEditor = EditorView.findFromDOM($('#panel-main-editor .cm-editor')[0]);
            if (mainEditor) {
                setMainEditorTheme(themeName);
                saveUserSettings();
            }
            $('#panel-settings').toggle();
        });
        
        $themesGrid.append($container);
    });

    return $themesGrid;
}