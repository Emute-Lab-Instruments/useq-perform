import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme, setMainEditorTheme } from "../../editors/themes/themeManager.mjs";
import { activeUserSettings, updateUserSettings} from "../../utils/persistentUserSettings.mjs";
import { baseExtensions } from "../../editors/extensions.mjs";
import { defaultThemeEditorStartingCode } from "../../editors/defaults.mjs";
import { dbg } from "../../utils.mjs";
import { el } from "../../utils/dom.mjs";

/**
 * Initialize the theme tab within the settings panel
 */
export function makeThemeTab() {
    // Create themes container
    const themesGrid = el('div', {
        class: 'panel-tab-content themes-container',
        id: 'panel-settings-themes'
    });

    // Add a title for the panel
    const panelTitle = el('h2', {
        class: 'panel-section-title',
        text: 'Select a Theme'
    });
    themesGrid.appendChild(panelTitle);

    // Create preview editors for each theme
    Object.entries(themes).forEach(([themeName, themeExtension]) => {
        const container = el('div', {
            class: 'theme-preview panel-section'
        });

        const label = el('div', {
            class: 'theme-name',
            text: themeName
        });
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
        view.contentDOM.setAttribute('contenteditable', 'false');

        // Add click handler to apply theme
        container.addEventListener('click', () => {
            const cmEl = document.querySelector('#panel-main-editor .cm-editor');
            const mainEditor = cmEl ? EditorView.findFromDOM(cmEl) : null;
            if (mainEditor) {
                const newSettings = {
                    editor: {
                        ...activeUserSettings.editor,
                        theme: themeName
                    }
                };
                updateUserSettings(newSettings);
                setMainEditorTheme(themeName);
            }
            const settingsPanel = document.getElementById('panel-settings');
            if (settingsPanel) {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? '' : 'none';
            }
        });

        themesGrid.appendChild(container);
    });

    return themesGrid;
}
