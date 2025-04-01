import { dbg } from "../../utils.mjs";
import { toggleAuxPanel } from '../ui.mjs';
import { activeUserSettings, updateUserSettings, resetUserSettings } from '../../utils/persistentUserSettings.mjs';
import { themes } from '../../editors/themes/themeManager.mjs';
import { setMainEditorTheme } from '../../editors/themes/themeManager.mjs';
import { setFontSize } from '../../editors/editorConfig.mjs';
import { EditorView } from '@codemirror/view';
import { initThemeTab } from './themes.mjs';
import { initGeneralTab } from "./general.mjs";
import { initKeybindingsTab } from "./keybindings.mjs";

/**
 * Initialize the settings tab within the settings panel
 */


/**
 * Initialize the settings panel with all tabs
 */
export function initSettingsPanel() {
    dbg("Settings Panel", "initSettingsPanel", "Starting initialization of the settings panel");
    const settingsPanel = $("#panel-settings");   

    console.log("!!!HI: ", document.querySelector("#panel-settings-general")); 
    initGeneralTab(document.querySelector("#panel-settings-general"));
    initKeybindingsTab(document.querySelector("#panel-settings-keybindings"));
    initThemeTab(document.querySelector("#panel-settings-theme"));

    dbg("Settings Panel", "initSettingsPanel", "Initialized settings and theme tabs");
    // Remove previous handlers if any
    $("#button-settings").off("click");
    
    // Add click handler using direct DOM for more reliable triggering
    const settingsButton = document.getElementById("button-settings");
    if (settingsButton) {
        settingsButton.addEventListener("click", function(e) {
            dbg("Settings Panel", "initSettingsPanel", "Settings button clicked");
            // Default to settings tab
            // NOTE: it should remember the last tab you clicked
            // $("#panel-settings-tab-general").click();
            
            toggleAuxPanel("#pannel-settings");
            
            // Apply theme-specific styling to form controls when the panel opens
            refreshControlStyling();
            dbg("Settings Panel", "initSettingsPanel", "Refreshed control styling");
            
            // Prevent event bubbling issues
            e.preventDefault();
            e.stopPropagation();
        });
    }
    dbg("Settings Panel", "initSettingsPanel", "Completed initialization of the settings panel");
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

