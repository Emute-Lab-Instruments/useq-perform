import {dbg} from "../../utils.mjs";
import {activeUserSettings, updateUserSettings, resetUserSettings} from "../../utils/persistentUserSettings.mjs";
import {themes} from "../../editors/themes/themeManager.mjs";

export function initGeneralTab(container) {
    if (!(container instanceof HTMLElement)) {
        dbg("Settings Tab", "initGeneralTab", "Invalid container passed to initGeneralTab");
        dbg(container);
        throw new TypeError("Expected a valid DOM element for 'container'");
    }
    container.className = 'settings-container';
    dbg("Settings Tab", "initSettingsTab", "Appended settings content container");


    dbg("Settings UI", "renderSettingsUI", "Rendering settings UI");
    // Create main sections
    const personalSection = createSection('Personal Settings');
    dbg("Settings UI", "renderSettingsUI", "Created personal settings section");
    const editorSection = createSection('Editor Settings');
    dbg("Settings UI", "renderSettingsUI", "Created editor settings section");
    const storageSection = createSection('Storage Settings');
    dbg("Settings UI", "renderSettingsUI", "Created storage settings section");
    const uiSection = createSection('UI Settings');
    dbg("Settings UI", "renderSettingsUI", "Created UI settings section");
    
    // Add to container
    container.appendChild(personalSection);
    container.appendChild(editorSection);
    container.appendChild(storageSection);
    container.appendChild(uiSection);
    dbg("Settings UI", "renderSettingsUI", "Appended all sections to container");
    
    // Build personal settings
    buildPersonalSettings(personalSection);
    dbg("Settings UI", "renderSettingsUI", "Built personal settings");

    // Build editor settings
    buildEditorSettings(editorSection);
    dbg("Settings UI", "renderSettingsUI", "Built editor settings");

    // Build storage settings
    buildStorageSettings(storageSection);
    dbg("Settings UI", "renderSettingsUI", "Built storage settings");

    // Build UI settings
    buildUISettings(uiSection);
    dbg("Settings UI", "renderSettingsUI", "Built UI settings");

    // Add reset button at the bottom
    const resetButtonContainer = document.createElement('div');
    resetButtonContainer.className = 'settings-reset-container';
    const resetButton = document.createElement('button');
    resetButton.className = 'settings-reset-button panel-button';
    resetButton.textContent = 'Reset All Settings';
    resetButton.addEventListener('click', () => {
        dbg("Settings UI", "resetButton", "Reset button clicked");
        if (confirm('Are you sure you want to reset all settings to default values?')) {
            resetUserSettings();
            dbg("Settings UI", "resetButton", "User settings reset to default");
            window.location.reload();
        }
    });
    resetButtonContainer.appendChild(resetButton);
    container.appendChild(resetButtonContainer);
    dbg("Settings UI", "renderSettingsUI", "Added reset button to container");
}

/**
 * Create a settings section with a title
 */
function createSection(title) {
    dbg("Settings UI", "createSection", `Creating section with title: ${title}`);
    const section = document.createElement('div');
    section.className = 'settings-section panel-section';
    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title panel-section-title';
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);
    dbg("Settings UI", "createSection", `Created section: ${title}`);
    return section;
}

/**
 * Create a form row with label and control
 */
function createFormRow(labelText, controlElement) {
    dbg("Settings UI", "createFormRow", `Creating form row with label: ${labelText}`);
    const row = document.createElement('div');
    row.className = 'settings-row panel-row';
    const label = document.createElement('label');
    label.className = 'settings-label panel-label';
    label.textContent = labelText;
    const control = document.createElement('div');
    control.className = 'settings-control panel-control';
    control.appendChild(controlElement);
    row.appendChild(label);
    row.appendChild(control);
    dbg("Settings UI", "createFormRow", `Created form row for label: ${labelText}`);
    return row;
}

/**
 * Build the personal settings section
 */
function buildPersonalSettings(container) {
    dbg("Settings UI", "buildPersonalSettings", "Building personal settings");
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'settings-text-input panel-text-input';
    nameInput.value = activeUserSettings.name || '';
    nameInput.placeholder = 'Enter your name';
    nameInput.addEventListener('change', () => {
        dbg("Settings UI", "buildPersonalSettings", "Name input changed");
        updateUserSettings({ name: nameInput.value });
    });
    container.appendChild(createFormRow('Your Name', nameInput));
    dbg("Settings UI", "buildPersonalSettings", "Added name input to personal settings");
}

/**
 * Build the editor settings section
 */
function buildEditorSettings(container) {
    dbg("Settings UI", "buildEditorSettings", "Building editor settings");
    const themeSelect = document.createElement('select');
    themeSelect.className = 'settings-select panel-select';
    Object.keys(themes).forEach(themeName => {
        const option = document.createElement('option');
        option.value = themeName;
        option.textContent = themeName;
        option.selected = activeUserSettings.editor?.theme === themeName;
        themeSelect.appendChild(option);
    });
    themeSelect.addEventListener('change', () => {
        dbg("Settings UI", "buildEditorSettings", "Theme selection changed");
        const newSettings = {
            editor: {
                ...activeUserSettings.editor,
                theme: themeSelect.value
            }
        };
        updateUserSettings(newSettings);
        setMainEditorTheme(themeSelect.value);
    });
    container.appendChild(createFormRow('Editor Theme', themeSelect));
    dbg("Settings UI", "buildEditorSettings", "Added theme selector to editor settings");

    const fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'number';
    fontSizeInput.className = 'settings-number-input panel-number-input';
    fontSizeInput.min = 8;
    fontSizeInput.max = 32;
    fontSizeInput.value = activeUserSettings.editor?.fontSize || 16;
    fontSizeInput.addEventListener('change', () => {
        dbg("Settings UI", "buildEditorSettings", "Font size input changed");
        const fontSize = parseInt(fontSizeInput.value, 10);
        if (fontSize >= 8 && fontSize <= 32) {
            const newSettings = {
                editor: {
                    ...activeUserSettings.editor,
                    fontSize: fontSize
                }
            };
            updateUserSettings(newSettings);
            const editor = EditorView.findFromDOM(document.querySelector("#panel-main-editor .cm-editor"));
            if (editor) {
                setFontSize(editor, fontSize);
            }
        }
    });
    container.appendChild(createFormRow('Font Size', fontSizeInput));
    dbg("Settings UI", "buildEditorSettings", "Added font size input to editor settings");
}

/**
 * Build the storage settings section
 */
function buildStorageSettings(container) {
    dbg("Settings UI", "buildStorageSettings", "Building storage settings");
    // Save code locally checkbox
    const saveLocallyCheckbox = document.createElement('input');
    saveLocallyCheckbox.type = 'checkbox';
    saveLocallyCheckbox.className = 'settings-checkbox panel-checkbox';
    saveLocallyCheckbox.checked = activeUserSettings.storage?.saveCodeLocally !== false;
    
    saveLocallyCheckbox.addEventListener('change', () => {
        dbg("Settings UI", "buildStorageSettings", "Save code locally checkbox changed");
        const newSettings = {
            storage: {
                ...activeUserSettings.storage,
                saveCodeLocally: saveLocallyCheckbox.checked
            }
        };
        updateUserSettings(newSettings);
    });
    
    container.appendChild(createFormRow('Save Code Locally', saveLocallyCheckbox));
    
    // Auto-save checkbox
    const autoSaveCheckbox = document.createElement('input');
    autoSaveCheckbox.type = 'checkbox';
    autoSaveCheckbox.className = 'settings-checkbox panel-checkbox';
    autoSaveCheckbox.checked = activeUserSettings.storage?.autoSaveEnabled !== false;
    
    autoSaveCheckbox.addEventListener('change', () => {
        dbg("Settings UI", "buildStorageSettings", "Auto-save checkbox changed");
        const newSettings = {
            storage: {
                ...activeUserSettings.storage,
                autoSaveEnabled: autoSaveCheckbox.checked
            }
        };
        updateUserSettings(newSettings);
        
        // Update autosave interval input state
        autoSaveIntervalInput.disabled = !autoSaveCheckbox.checked;
    });
    
    container.appendChild(createFormRow('Auto-Save Enabled', autoSaveCheckbox));
    
    // Auto-save interval
    const autoSaveIntervalInput = document.createElement('input');
    autoSaveIntervalInput.type = 'number';
    autoSaveIntervalInput.className = 'settings-number-input panel-number-input';
    autoSaveIntervalInput.min = 1000;
    autoSaveIntervalInput.max = 60000;
    autoSaveIntervalInput.step = 1000;
    autoSaveIntervalInput.value = activeUserSettings.storage?.autoSaveInterval || 5000;
    autoSaveIntervalInput.disabled = !autoSaveCheckbox.checked;
    
    autoSaveIntervalInput.addEventListener('change', () => {
        dbg("Settings UI", "buildStorageSettings", "Auto-save interval input changed");
        const interval = parseInt(autoSaveIntervalInput.value, 10);
        if (interval >= 1000 && interval <= 60000) {
            const newSettings = {
                storage: {
                    ...activeUserSettings.storage,
                    autoSaveInterval: interval
                }
            };
            updateUserSettings(newSettings);
        }
    });
    
    container.appendChild(createFormRow('Auto-Save Interval (ms)', autoSaveIntervalInput));
}

/**
 * Build the UI settings section
 */
function buildUISettings(container) {
    dbg("Settings UI", "buildUISettings", "Building UI settings");
    // Console lines limit
    const consoleLinesInput = document.createElement('input');
    consoleLinesInput.type = 'number';
    consoleLinesInput.className = 'settings-number-input panel-number-input';
    consoleLinesInput.min = 100;
    consoleLinesInput.max = 10000;
    consoleLinesInput.value = activeUserSettings.ui?.consoleLinesLimit || 1000;
    
    consoleLinesInput.addEventListener('change', () => {
        dbg("Settings UI", "buildUISettings", "Console lines limit input changed");
        const lines = parseInt(consoleLinesInput.value, 10);
        if (lines >= 100 && lines <= 10000) {
            const newSettings = {
                ui: {
                    ...activeUserSettings.ui,
                    consoleLinesLimit: lines
                }
            };
            updateUserSettings(newSettings);
        }
    });
    
    container.appendChild(createFormRow('Console Line Limit', consoleLinesInput));
}