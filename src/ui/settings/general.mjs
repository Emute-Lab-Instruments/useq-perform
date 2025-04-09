import {activeUserSettings, updateUserSettings, resetUserSettings} from "../../utils/persistentUserSettings.mjs";
import {themes} from "../../editors/themes/themeManager.mjs";
import { setMainEditorTheme } from "../../editors/themes/themeManager.mjs";

export function makeGeneralTab() {
    const $container = $('<div>').addClass('panel-tab-content');

    // Create main sections
    const $personalSection = createSection('Personal Settings');
    const $editorSection = createSection('Editor Settings');
    const $storageSection = createSection('Storage Settings');
    const $uiSection = createSection('UI Settings');
    
    // Add to container
    $container.append($personalSection, $editorSection, $storageSection, $uiSection);
    
    // Build personal settings
    buildPersonalSettings($personalSection);

    // Build editor settings
    buildEditorSettings($editorSection);

    // Build storage settings
    buildStorageSettings($storageSection);

    // Build UI settings
    buildUISettings($uiSection);

    // Add reset button at the bottom
    const $resetButtonContainer = $('<div>').addClass('panel-section');
    const $resetButton = $('<button>')
        .addClass('panel-button reset')
        .text('Reset All Settings')
        .on('click', () => {
            if (confirm('Are you sure you want to reset all settings to default values?')) {
                resetUserSettings();
                window.location.reload();
            }
        });
    
    $resetButtonContainer.append($resetButton);
    $container.append($resetButtonContainer);

    return $container;
}

/**
 * Create a settings section with a title
 */
function createSection(title) {
    const $section = $('<div>').addClass('panel-section');
    const $sectionTitle = $('<h3>')
        .addClass('panel-section-title')
        .text(title);
    $section.append($sectionTitle);
    return $section;
}

/**
 * Create a form row with label and control
 */
function createFormRow(labelText, $controlElement) {
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
    const $nameInput = $('<input>')
        .attr('type', 'text')
        .addClass('panel-text-input')
        .val(activeUserSettings.name || '')
        .attr('placeholder', 'Enter your name')
        .on('change', () => {
            updateUserSettings({ name: $nameInput.val() });
        });
    
    $container.append(createFormRow('Your Name', $nameInput));
}

/**
 * Build the editor settings section
 */
function buildEditorSettings($container) {
    const $themeSelect = $('<select>').addClass('panel-select');
    
    Object.keys(themes).forEach(themeName => {
        $('<option>')
            .val(themeName)
            .text(themeName)
            .prop('selected', activeUserSettings.editor?.theme === themeName)
            .appendTo($themeSelect);
    });
    
    $themeSelect.on('change', () => {
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

    const $fontSizeInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 8)
        .attr('max', 32)
        .val(activeUserSettings.editor?.fontSize || 16)
        .on('change', () => {
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
}

/**
 * Build the storage settings section
 */
function buildStorageSettings($container) {
    const $saveLocallyCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', activeUserSettings.storage?.saveCodeLocally !== false)
        .on('change', () => {
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
    const $consoleLinesInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 100)
        .attr('max', 10000)
        .val(activeUserSettings.ui?.consoleLinesLimit || 1000)
        .on('change', () => {
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