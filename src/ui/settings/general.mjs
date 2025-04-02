import {dbg} from "../../utils.mjs";
import {activeUserSettings, updateUserSettings, resetUserSettings} from "../../utils/persistentUserSettings.mjs";
import {themes} from "../../editors/themes/themeManager.mjs";

export function makeGeneralTab() {
    console.log("initGeneralTab");

    const $container = $('<div>').addClass('panel-tab-content');
    dbg("Settings Tab", "initSettingsTab", "Appended settings content container");

    dbg("Settings UI", "renderSettingsUI", "Rendering settings UI");
    // Create main sections
    const $personalSection = createSection('Personal Settings');
    dbg("Settings UI", "renderSettingsUI", "Created personal settings section");
    const $editorSection = createSection('Editor Settings');
    dbg("Settings UI", "renderSettingsUI", "Created editor settings section");
    const $storageSection = createSection('Storage Settings');
    dbg("Settings UI", "renderSettingsUI", "Created storage settings section");
    const $uiSection = createSection('UI Settings');
    dbg("Settings UI", "renderSettingsUI", "Created UI settings section");
    
    // Add to container
    $container.append($personalSection, $editorSection, $storageSection, $uiSection);
    dbg("Settings UI", "renderSettingsUI", "Appended all sections to container");
    
    // Build personal settings
    buildPersonalSettings($personalSection);
    dbg("Settings UI", "renderSettingsUI", "Built personal settings");

    // Build editor settings
    buildEditorSettings($editorSection);
    dbg("Settings UI", "renderSettingsUI", "Built editor settings");

    // Build storage settings
    buildStorageSettings($storageSection);
    dbg("Settings UI", "renderSettingsUI", "Built storage settings");

    // Build UI settings
    buildUISettings($uiSection);
    dbg("Settings UI", "renderSettingsUI", "Built UI settings");

    // Add reset button at the bottom
    const $resetButtonContainer = $('<div>').addClass('panel-section');
    const $resetButton = $('<button>')
        .addClass('panel-button')
        .text('Reset All Settings')
        .on('click', () => {
            dbg("Settings UI", "resetButton", "Reset button clicked");
            if (confirm('Are you sure you want to reset all settings to default values?')) {
                resetUserSettings();
                dbg("Settings UI", "resetButton", "User settings reset to default");
                window.location.reload();
            }
        });
    
    $resetButtonContainer.append($resetButton);
    $container.append($resetButtonContainer);
    dbg("Settings UI", "renderSettingsUI", "Added reset button to container");

    return $container;
}

/**
 * Create a settings section with a title
 */
function createSection(title) {
    dbg("Settings UI", "createSection", `Creating section with title: ${title}`);
    const $section = $('<div>').addClass('panel-section');
    const $sectionTitle = $('<h3>')
        .addClass('panel-section-title')
        .text(title);
    $section.append($sectionTitle);
    dbg("Settings UI", "createSection", `Created section: ${title}`);
    return $section;
}

/**
 * Create a form row with label and control
 */
function createFormRow(labelText, $controlElement) {
    dbg("Settings UI", "createFormRow", `Creating form row with label: ${labelText}`);
    const $row = $('<div>').addClass('panel-row');
    const $label = $('<label>')
        .addClass('panel-label')
        .text(labelText);
    const $control = $('<div>')
        .addClass('panel-control')
        .append($controlElement);
    return $row.append($label, $control);
}

/**
 * Build the personal settings section
 */
function buildPersonalSettings($container) {
    dbg("Settings UI", "buildPersonalSettings", "Building personal settings");
    const $nameInput = $('<input>')
        .attr('type', 'text')
        .addClass('panel-text-input')
        .val(activeUserSettings.name || '')
        .attr('placeholder', 'Enter your name')
        .on('change', () => {
            dbg("Settings UI", "buildPersonalSettings", "Name input changed");
            updateUserSettings({ name: $nameInput.val() });
        });
    
    $container.append(createFormRow('Your Name', $nameInput));
    dbg("Settings UI", "buildPersonalSettings", "Added name input to personal settings");
}

/**
 * Build the editor settings section
 */
function buildEditorSettings($container) {
    dbg("Settings UI", "buildEditorSettings", "Building editor settings");
    const $themeSelect = $('<select>').addClass('panel-select');
    
    Object.keys(themes).forEach(themeName => {
        $('<option>')
            .val(themeName)
            .text(themeName)
            .prop('selected', activeUserSettings.editor?.theme === themeName)
            .appendTo($themeSelect);
    });
    
    $themeSelect.on('change', () => {
        dbg("Settings UI", "buildEditorSettings", "Theme selection changed");
        const newSettings = {
            editor: {
                ...activeUserSettings.editor,
                theme: $themeSelect.val()
            }
        };
        updateUserSettings(newSettings);
        setMainEditorTheme($themeSelect.val());
    });
    
    $container.append(createFormRow('Editor Theme', $themeSelect));
    dbg("Settings UI", "buildEditorSettings", "Added theme selector to editor settings");

    const $fontSizeInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 8)
        .attr('max', 32)
        .val(activeUserSettings.editor?.fontSize || 16)
        .on('change', () => {
            dbg("Settings UI", "buildEditorSettings", "Font size input changed");
            const fontSize = parseInt($fontSizeInput.val(), 10);
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
    
    $container.append(createFormRow('Font Size', $fontSizeInput));
    dbg("Settings UI", "buildEditorSettings", "Added font size input to editor settings");
}

/**
 * Build the storage settings section
 */
function buildStorageSettings($container) {
    dbg("Settings UI", "buildStorageSettings", "Building storage settings");
    const $saveLocallyCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', activeUserSettings.storage?.saveCodeLocally !== false)
        .on('change', () => {
            dbg("Settings UI", "buildStorageSettings", "Save code locally checkbox changed");
            const newSettings = {
                storage: {
                    ...activeUserSettings.storage,
                    saveCodeLocally: $saveLocallyCheckbox.prop('checked')
                }
            };
            updateUserSettings(newSettings);
        });
    
    $container.append(createFormRow('Save Code Locally', $saveLocallyCheckbox));
    
    const $autoSaveCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', activeUserSettings.storage?.autoSaveEnabled !== false)
        .on('change', () => {
            dbg("Settings UI", "buildStorageSettings", "Auto-save checkbox changed");
            const newSettings = {
                storage: {
                    ...activeUserSettings.storage,
                    autoSaveEnabled: $autoSaveCheckbox.prop('checked')
                }
            };
            updateUserSettings(newSettings);
            $autoSaveIntervalInput.prop('disabled', !$autoSaveCheckbox.prop('checked'));
        });
    
    $container.append(createFormRow('Auto-Save Enabled', $autoSaveCheckbox));
    
    const $autoSaveIntervalInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 1000)
        .attr('max', 60000)
        .attr('step', 1000)
        .val(activeUserSettings.storage?.autoSaveInterval || 5000)
        .prop('disabled', !$autoSaveCheckbox.prop('checked'))
        .on('change', () => {
            dbg("Settings UI", "buildStorageSettings", "Auto-save interval input changed");
            const interval = parseInt($autoSaveIntervalInput.val(), 10);
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
    
    $container.append(createFormRow('Auto-Save Interval (ms)', $autoSaveIntervalInput));
}

/**
 * Build the UI settings section
 */
function buildUISettings($container) {
    dbg("Settings UI", "buildUISettings", "Building UI settings");
    const $consoleLinesInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 100)
        .attr('max', 10000)
        .val(activeUserSettings.ui?.consoleLinesLimit || 1000)
        .on('change', () => {
            dbg("Settings UI", "buildUISettings", "Console lines limit input changed");
            const lines = parseInt($consoleLinesInput.val(), 10);
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
    
    $container.append(createFormRow('Console Line Limit', $consoleLinesInput));
}