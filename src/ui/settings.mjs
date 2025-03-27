import { toggleAuxPanel } from './ui.mjs';
import { activeUserSettings, updateUserSettings, resetUserSettings } from '../utils/persistentUserSettings.mjs';
import { themes } from '../editors/themes/themeManager.mjs';
import { setMainEditorTheme } from '../editors/themes/themeManager.mjs';
import { setFontSize } from '../editors/editorConfig.mjs';
import { EditorView } from '@codemirror/view';

/**
 * Initialize the settings panel
 */
export function initSettingsPanel() {
    const settingsPanel = document.getElementById('panel-settings');
    
    // Create and add the toggle position button
    const togglePositionButton = document.createElement('button');
    togglePositionButton.id = 'panel-settings-toggle-position';
    togglePositionButton.innerHTML = '⇄';
    togglePositionButton.title = 'Toggle panel position';
    settingsPanel.appendChild(togglePositionButton);
    
    // Add toggle position functionality
    togglePositionButton.addEventListener('click', () => {
        settingsPanel.classList.toggle('centered');
    });
    
    // Create settings container
    const settingsContainer = document.createElement('div');
    settingsContainer.className = 'settings-container';
    settingsPanel.appendChild(settingsContainer);
    
    // Render settings UI
    renderSettingsUI(settingsContainer);
    
    // Button click handler - Fix: Changed from "#settingsButton" to "#button-settings"
    $("#button-settings").on("click", () => {
        toggleAuxPanel("#panel-settings");
    });
    
    // Handle ESC key to close panel
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#panel-settings").is(":visible")) {
            toggleAuxPanel("#panel-settings");
        }
    });
}

/**
 * Render the settings UI with all form controls
 */
function renderSettingsUI(container) {
    // Create main sections
    const personalSection = createSection('Personal Settings');
    const editorSection = createSection('Editor Settings');
    const storageSection = createSection('Storage Settings');
    const uiSection = createSection('UI Settings');
    
    // Add to container
    container.appendChild(personalSection);
    container.appendChild(editorSection);
    container.appendChild(storageSection);
    container.appendChild(uiSection);
    
    // Build personal settings
    buildPersonalSettings(personalSection);
    
    // Build editor settings
    buildEditorSettings(editorSection);
    
    // Build storage settings
    buildStorageSettings(storageSection);
    
    // Build UI settings
    buildUISettings(uiSection);
    
    // Add reset button at the bottom
    const resetButtonContainer = document.createElement('div');
    resetButtonContainer.className = 'settings-reset-container';
    
    const resetButton = document.createElement('button');
    resetButton.className = 'settings-reset-button';
    resetButton.textContent = 'Reset All Settings';
    resetButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all settings to default values?')) {
            resetUserSettings();
            // Reload the page to apply default settings
            window.location.reload();
        }
    });
    
    resetButtonContainer.appendChild(resetButton);
    container.appendChild(resetButtonContainer);
}

/**
 * Create a settings section with a title
 */
function createSection(title) {
    const section = document.createElement('div');
    section.className = 'settings-section';
    
    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = title;
    
    section.appendChild(sectionTitle);
    return section;
}

/**
 * Create a form row with label and control
 */
function createFormRow(labelText, controlElement) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    
    const label = document.createElement('label');
    label.className = 'settings-label';
    label.textContent = labelText;
    
    const control = document.createElement('div');
    control.className = 'settings-control';
    control.appendChild(controlElement);
    
    row.appendChild(label);
    row.appendChild(control);
    
    return row;
}

/**
 * Build the personal settings section
 */
function buildPersonalSettings(container) {
    // User name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'settings-text-input';
    nameInput.value = activeUserSettings.name || '';
    nameInput.placeholder = 'Enter your name';
    nameInput.addEventListener('change', () => {
        updateUserSettings({ name: nameInput.value });
    });
    
    container.appendChild(createFormRow('Your Name', nameInput));
}

/**
 * Build the editor settings section
 */
function buildEditorSettings(container) {
    // Theme selector
    const themeSelect = document.createElement('select');
    themeSelect.className = 'settings-select';
    
    // Add theme options
    Object.keys(themes).forEach(themeName => {
        const option = document.createElement('option');
        option.value = themeName;
        option.textContent = themeName;
        option.selected = activeUserSettings.editor?.theme === themeName;
        themeSelect.appendChild(option);
    });
    
    themeSelect.addEventListener('change', () => {
        const newSettings = {
            editor: {
                ...activeUserSettings.editor,
                theme: themeSelect.value
            }
        };
        updateUserSettings(newSettings);
        
        // Apply the theme change immediately
        setMainEditorTheme(themeSelect.value);
    });
    
    container.appendChild(createFormRow('Editor Theme', themeSelect));
    
    // Font size input
    const fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'number';
    fontSizeInput.className = 'settings-number-input';
    fontSizeInput.min = 8;
    fontSizeInput.max = 32;
    fontSizeInput.value = activeUserSettings.editor?.fontSize || 16;
    
    fontSizeInput.addEventListener('change', () => {
        const fontSize = parseInt(fontSizeInput.value, 10);
        if (fontSize >= 8 && fontSize <= 32) {
            const newSettings = {
                editor: {
                    ...activeUserSettings.editor,
                    fontSize: fontSize
                }
            };
            updateUserSettings(newSettings);
            
            // Apply the font size change immediately
            const editor = EditorView.findFromDOM(document.querySelector("#panel-main-editor .cm-editor"));
            if (editor) {
                setFontSize(editor, fontSize);
            }
        }
    });
    
    container.appendChild(createFormRow('Font Size', fontSizeInput));
}

/**
 * Build the storage settings section
 */
function buildStorageSettings(container) {
    // Save code locally checkbox
    const saveLocallyCheckbox = document.createElement('input');
    saveLocallyCheckbox.type = 'checkbox';
    saveLocallyCheckbox.className = 'settings-checkbox';
    saveLocallyCheckbox.checked = activeUserSettings.storage?.saveCodeLocally !== false;
    
    saveLocallyCheckbox.addEventListener('change', () => {
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
    autoSaveCheckbox.className = 'settings-checkbox';
    autoSaveCheckbox.checked = activeUserSettings.storage?.autoSaveEnabled !== false;
    
    autoSaveCheckbox.addEventListener('change', () => {
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
    autoSaveIntervalInput.className = 'settings-number-input';
    autoSaveIntervalInput.min = 1000;
    autoSaveIntervalInput.max = 60000;
    autoSaveIntervalInput.step = 1000;
    autoSaveIntervalInput.value = activeUserSettings.storage?.autoSaveInterval || 5000;
    autoSaveIntervalInput.disabled = !autoSaveCheckbox.checked;
    
    autoSaveIntervalInput.addEventListener('change', () => {
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
    // Console lines limit
    const consoleLinesInput = document.createElement('input');
    consoleLinesInput.type = 'number';
    consoleLinesInput.className = 'settings-number-input';
    consoleLinesInput.min = 100;
    consoleLinesInput.max = 10000;
    consoleLinesInput.value = activeUserSettings.ui?.consoleLinesLimit || 1000;
    
    consoleLinesInput.addEventListener('change', () => {
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