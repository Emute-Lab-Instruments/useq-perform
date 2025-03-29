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
    
    // Create settings container
    const settingsContainer = document.createElement('div');
    settingsContainer.className = 'settings-container';
    settingsPanel.appendChild(settingsContainer);
    
    // Render settings UI
    renderSettingsUI(settingsContainer);
    
    // Remove previous handlers if any
    $("#button-settings").off("click");
    
    // Add click handler using direct DOM for more reliable triggering
    const settingsButton = document.getElementById("button-settings");
    if (settingsButton) {
        settingsButton.addEventListener("click", function(e) {
            console.log("Settings button clicked - direct event listener");
            toggleAuxPanel("#panel-settings");
            
            // Apply theme-specific styling to form controls when the panel opens
            refreshControlStyling();
            
            // Prevent event bubbling issues
            e.preventDefault();
            e.stopPropagation();
        });
    }
}

/**
 * Refresh the styling of form controls based on the current theme
 * This ensures all controls remain readable in both light and dark themes
 */
function refreshControlStyling() {
    // Determine if we're using a light theme by checking the --text-primary variable
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    
    // Convert the color to RGB to check its brightness
    let isLightText = false;
    if (textColor.startsWith('#')) {
        // For hex color
        const hex = textColor.substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        // Calculate perceived brightness (human eye favors green)
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
        isLightText = brightness > 128;
    } else if (textColor.startsWith('rgb')) {
        // For rgb color
        const rgb = textColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
            isLightText = brightness > 128;
        }
    }
    
    // If we have light text, we're in a dark theme, otherwise we're in a light theme
    const isLightTheme = !isLightText;
    
    // Adjust form control styles as needed
    if (isLightTheme) {
        // Light theme - ensure text on form controls is dark for contrast
        $('.panel-text-input, .panel-number-input, .panel-select').css({
            'color': '#333',
            'background-color': '#f9f9f9',
            'border-color': '#ccc'
        });
        
        // Ensure checkboxes are visible against background
        $('.panel-checkbox').css({
            'accent-color': 'var(--accent-color, #0066cc)',
            'box-shadow': '0 0 2px rgba(0, 0, 0, 0.2)'
        });
        
        // Make section titles and key bindings more visible in light mode
        $('.panel-section-title').css('color', 'var(--accent-color, #0066cc)');
        $('.key-binding').css({
            'background-color': '#f0f0f0',
            'border': '1px solid #ccc',
            'color': '#333'
        });
    } else {
        // Dark theme - ensure form controls use the default dark theme styling
        $('.panel-text-input, .panel-number-input, .panel-select').css({
            'color': 'var(--text-primary)',
            'background-color': 'var(--panel-control-bg)',
            'border-color': 'var(--panel-border)'
        });
        
        // Reset checkbox styling
        $('.panel-checkbox').css({
            'accent-color': 'var(--accent-color, #00ff41)',
            'box-shadow': 'none'
        });
        
        // Reset section titles and key bindings
        $('.panel-section-title').css('color', 'var(--accent-color, #00ff41)');
        $('.key-binding').css({
            'background-color': 'var(--panel-control-bg)',
            'border': 'none',
            'color': 'var(--text-primary)'
        });
    }
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
    resetButton.className = 'settings-reset-button panel-button'; // Added unified class
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
    section.className = 'settings-section panel-section'; // Added unified class
    
    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title panel-section-title'; // Added unified class
    sectionTitle.textContent = title;
    
    section.appendChild(sectionTitle);
    return section;
}

/**
 * Create a form row with label and control
 */
function createFormRow(labelText, controlElement) {
    const row = document.createElement('div');
    row.className = 'settings-row panel-row'; // Added unified class
    
    const label = document.createElement('label');
    label.className = 'settings-label panel-label'; // Added unified class
    label.textContent = labelText;
    
    const control = document.createElement('div');
    control.className = 'settings-control panel-control'; // Added unified class
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
    nameInput.className = 'settings-text-input panel-text-input';
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
    themeSelect.className = 'settings-select panel-select';
    
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
    fontSizeInput.className = 'settings-number-input panel-number-input';
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
    saveLocallyCheckbox.className = 'settings-checkbox panel-checkbox';
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
    autoSaveCheckbox.className = 'settings-checkbox panel-checkbox';
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
    autoSaveIntervalInput.className = 'settings-number-input panel-number-input';
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
    consoleLinesInput.className = 'settings-number-input panel-number-input';
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